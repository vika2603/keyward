import { ruleForHost } from "@/lib/matching"
import {
  type Folder,
  type NewLogin,
  VaultError,
  type VaultInfo,
} from "@/lib/providers/types"
import { getSettings, type SiteRule, updateSettings } from "@/lib/settings"
import { siteDomainOf } from "@/lib/site"
import type { PromptState } from "./api"
import { MAX_TEXT_LENGTH } from "./limits"
import { type PromptSession, promptSessions } from "./overlays"
import { frameUrl, sendToFrame } from "./page"
import type { Providers } from "./providers"
import { recallUsername, rememberUsername } from "./recent-usernames"
import { defaultTarget, promptTargets } from "./save-targets"

/** A save prompt shows again on pages loaded within this time after the login, until it is answered. */
const PROMPT_TTL_MS = 3 * 60_000

interface SubmittedLogin {
  username: string
  password: string
  /** Whether the password was typed into a field for a new password. */
  newPassword?: boolean
}

interface StoredLogin {
  vaultId: string
  loginId: string
}

/** How the ready vaults hold a submitted login, which decides what the prompt offers. */
type Holding =
  | { kind: "unchanged" }
  | { kind: "changed"; login: StoredLogin }
  | { kind: "missing" }

/** The username of the site's only saved account, for a change-password form that does not name it. */
async function onlyUsername(providers: Providers, page: URL): Promise<string> {
  const names = new Set(
    (await providers.loginsForPage(page))
      .flatMap((vault) => vault.logins.map((login) => login.username))
      .filter(Boolean),
  )
  return names.size === 1 ? ([...names][0] ?? "") : ""
}

/**
 * Compares a submitted login with the vaults. It counts as unchanged when a vault has it with this
 * password, when a vault cannot tell (Apple Passwords does not reveal a password without Touch ID)
 * and the password was not typed as a new one, or when the vaults that have it are ones Keyward may
 * not change, so it is neither updated nor saved a second time.
 */
async function holdingOf(
  providers: Providers,
  vaults: VaultInfo[],
  page: URL,
  account: string,
  submitted: SubmittedLogin,
): Promise<Holding> {
  let changed: StoredLogin | null = null
  let keptUnchangeable = false
  for (const vault of vaults) {
    const existing = await providers
      .providerOf(vault.id)
      .findExisting(vault.id, page, account, submitted.password)
      .catch(() => null)
    if (!existing) continue
    if (existing.samePassword === true) return { kind: "unchanged" }
    if (existing.samePassword === undefined && !submitted.newPassword)
      return { kind: "unchanged" }
    if (existing.editable === false) {
      keptUnchangeable = true
      continue
    }
    changed ??= { vaultId: vault.id, loginId: existing.loginId }
  }
  if (changed) return { kind: "changed", login: changed }
  return keptUnchangeable ? { kind: "unchanged" } : { kind: "missing" }
}

/** Handles a login form the user submitted: offers to save a login no vault has, or to update one. */
export async function onSubmitted(
  providers: Providers,
  tabId: number,
  frameId: number,
  submitted: SubmittedLogin,
): Promise<void> {
  if (
    submitted.username.length > MAX_TEXT_LENGTH ||
    submitted.password.length > MAX_TEXT_LENGTH
  )
    return
  const page = await frameUrl(tabId, frameId)
  if (!page) return
  const settings = await getSettings()
  const behavior = ruleForHost(settings.siteRules, page.hostname)?.behavior
  if (behavior === "noSave" || behavior === "disabled") return
  const site = siteDomainOf(page.hostname)
  const username =
    submitted.username.trim() || (await recallUsername(tabId, site)) || ""
  if (!submitted.password) {
    if (username) await rememberUsername(tabId, site, username)
    return
  }
  const account =
    username ||
    (submitted.newPassword ? await onlyUsername(providers, page) : "")
  if (!account) return

  const vaults = (await providers.vaultsForPage(page)).filter(
    (vault) => vault.status === "ready",
  )
  if (!vaults.length) return
  const holding = await holdingOf(providers, vaults, page, account, submitted)
  if (holding.kind === "unchanged") return
  const update = holding.kind === "changed" ? holding.login : null
  const userWantsPrompt = update ? settings.askUpdate : settings.askSave
  if (!userWantsPrompt) return
  if (!update && !(await promptTargets(providers, page)).length) return

  await promptSessions.set({
    tabId,
    frameId: 0,
    token: crypto.randomUUID(),
    overlayFrameId: null,
    mode: update ? "update" : "save",
    url: page.href,
    username: account,
    password: submitted.password,
    update,
    createdAt: Date.now(),
  })
  await showPrompt(tabId)
}

/**
 * Shows a pending prompt in the tab's top frame; called again when a new page there is ready, as
 * long as that page belongs to the site of the login.
 */
export async function showPrompt(tabId: number): Promise<void> {
  const session = await promptSessions.get(tabId)
  if (!session) return
  if (Date.now() - session.createdAt > PROMPT_TTL_MS) {
    await promptSessions.remove(tabId)
    return
  }
  const top = await frameUrl(tabId, 0)
  if (
    !top ||
    siteDomainOf(top.hostname) !== siteDomainOf(new URL(session.url).hostname)
  )
    return
  const token = crypto.randomUUID()
  await promptSessions.set({ ...session, token, overlayFrameId: null })
  await sendToFrame(tabId, 0, { type: "prompt.show", token }).catch(() => {})
}

export async function promptState(
  providers: Providers,
  session: PromptSession,
): Promise<PromptState> {
  const page = new URL(session.url)
  const targets =
    session.mode === "save" ? await promptTargets(providers, page) : []
  const updateVault = session.update
    ? await providers.vault(session.update.vaultId).catch(() => null)
    : null
  return {
    mode: session.mode,
    username: session.username,
    host: page.hostname,
    targets,
    defaultTarget: await defaultTarget(targets),
    updateVault,
  }
}

/** The folders of a vault the prompt offers; none for a vault it does not offer. */
export async function promptFolders(
  providers: Providers,
  session: PromptSession,
  vaultId: string,
): Promise<Folder[]> {
  const targets = await promptTargets(providers, new URL(session.url))
  if (!targets.some((target) => target.id === vaultId)) return []
  const provider = providers.providerOf(vaultId)
  return provider.folders ? provider.folders(vaultId) : []
}

export async function confirmPrompt(
  providers: Providers,
  session: PromptSession,
  targetId: string | null,
  choices: { name: string; folderId: string | null } = {
    name: "",
    folderId: null,
  },
): Promise<void> {
  const url = new URL(session.url)
  const login: NewLogin = {
    url,
    username: session.username,
    password: session.password,
    details: { ...choices, notes: "", totp: "", customFields: [] },
  }
  const tab = { tabId: session.tabId, frameId: 0 }
  if (session.update) {
    const { vaultId, loginId } = session.update
    await providers.providerOf(vaultId).update(vaultId, loginId, login, tab)
  } else {
    const targets = await promptTargets(providers, url)
    const target = targets.find((candidate) => candidate.id === targetId)
    if (!target)
      throw new VaultError("The chosen place is not available", "unknownVault")
    await providers.providerOf(target.id).save(target.id, login, tab)
  }
  await closePrompt(session.tabId)
}

/**
 * Stops asking to save logins on the prompt's site. A new rule for the host keeps the vaults and
 * match type of a rule for a parent domain, which it overrides as the more specific one.
 */
export async function neverForSite(session: PromptSession): Promise<void> {
  const host = new URL(session.url).hostname
  const { siteRules } = await getSettings()
  await updateSettings({ siteRules: withNoSaveRule(siteRules, host) })
  await closePrompt(session.tabId)
}

function withNoSaveRule(rules: SiteRule[], host: string): SiteRule[] {
  const ownRule = rules.find((rule) => rule.host === host)
  if (ownRule)
    return rules.map((rule) =>
      rule === ownRule ? { ...rule, behavior: "noSave" } : rule,
    )
  const parentRule = ruleForHost(rules, host)
  return [
    ...rules,
    {
      id: crypto.randomUUID(),
      host,
      match: parentRule?.match ?? null,
      provider: parentRule?.provider ?? "all",
      behavior: "noSave",
    },
  ]
}

export async function closePrompt(tabId: number): Promise<void> {
  await promptSessions.remove(tabId)
  await sendToFrame(tabId, 0, { type: "prompt.close" }).catch(() => {})
}

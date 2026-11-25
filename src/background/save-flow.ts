import { ruleForHost } from "@/lib/matching"
import { VaultError, type VaultInfo } from "@/lib/providers/types"
import { getSettings, updateSettings } from "@/lib/settings"
import { siteDomainOf } from "@/lib/site"
import type { PromptState, VaultView } from "./api"
import { prompts } from "./overlays"
import { frameUrl, sendToFrame } from "./page"
import type { Providers } from "./providers"

const USERNAMES_KEY = "save.usernames"
/** A username typed on the first page of a two-step login is used for a password within this time. */
const USERNAME_TTL_MS = 5 * 60_000
/** A save prompt shows again on pages loaded within this time after the login, until it is answered. */
const PROMPT_TTL_MS = 3 * 60_000
const MAX_FIELD_LENGTH = 1024

type RememberedUsernames = Record<
  string,
  { site: string; username: string; at: number }
>

async function rememberedUsernames(): Promise<RememberedUsernames> {
  return (
    ((await browser.storage.session.get(USERNAMES_KEY))[
      USERNAMES_KEY
    ] as RememberedUsernames) ?? {}
  )
}

/** Remembers the username a tab last signed in with on a site, for the steps that follow. */
export async function rememberUsername(
  tabId: number,
  site: string,
  username: string,
): Promise<void> {
  const all = await rememberedUsernames()
  await browser.storage.session.set({
    [USERNAMES_KEY]: { ...all, [tabId]: { site, username, at: Date.now() } },
  })
}

export async function recallUsername(
  tabId: number,
  site: string,
): Promise<string | null> {
  const entry = (await rememberedUsernames())[tabId]
  if (!entry || entry.site !== site || Date.now() - entry.at > USERNAME_TTL_MS)
    return null
  return entry.username
}

/**
 * Puts the login this tab used on the site moments ago first, in its vault and among the vaults,
 * so it is the first one offered for the next step.
 */
export function markRecent(
  vaults: VaultView[],
  username: string | null,
): VaultView[] {
  const name = username?.trim().toLowerCase()
  if (!name) return vaults
  const marked = vaults.map((vault) => {
    const logins = vault.logins.map((login) =>
      login.username.trim().toLowerCase() === name
        ? { ...login, recent: true }
        : login,
    )
    return {
      ...vault,
      logins: [
        ...logins.filter((l) => l.recent),
        ...logins.filter((l) => !l.recent),
      ],
    }
  })
  return [
    ...marked.filter((vault) => vault.logins.some((l) => l.recent)),
    ...marked.filter((vault) => !vault.logins.some((l) => l.recent)),
  ]
}

export async function forgetTab(tabId: number): Promise<void> {
  const { [tabId]: _removed, ...rest } = await rememberedUsernames()
  await browser.storage.session.set({ [USERNAMES_KEY]: rest })
  await prompts.remove(tabId)
}

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
 * Handles a login form the user submitted. Offers to save a login no vault has, or to update one
 * whose password differs. Apple Passwords does not reveal saved passwords without Touch ID, so a
 * username it already has counts as saved, unless the password was typed as a new one.
 */
export async function onSubmitted(
  providers: Providers,
  tabId: number,
  frameId: number,
  submitted: { username: string; password: string; newPassword?: boolean },
): Promise<void> {
  if (
    submitted.username.length > MAX_FIELD_LENGTH ||
    submitted.password.length > MAX_FIELD_LENGTH
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
  let update: { vaultId: string; loginId: string } | null = null
  for (const vault of vaults) {
    const existing = await providers
      .providerOf(vault.id)
      .findExisting(vault.id, page, account, submitted.password)
      .catch(() => null)
    if (!existing) continue
    if (existing.samePassword === true) return
    if (existing.samePassword === undefined && !submitted.newPassword) return
    update ??= { vaultId: vault.id, loginId: existing.loginId }
  }
  if (update ? !settings.askUpdate : !settings.askSave) return
  if (!update && !(await saveTargets(providers, page)).length) return

  await prompts.set({
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
  const session = await prompts.get(tabId)
  if (!session) return
  if (Date.now() - session.createdAt > PROMPT_TTL_MS) {
    await prompts.remove(tabId)
    return
  }
  const top = await frameUrl(tabId, 0)
  if (
    !top ||
    siteDomainOf(top.hostname) !== siteDomainOf(new URL(session.url).hostname)
  )
    return
  const token = crypto.randomUUID()
  await prompts.set({ ...session, token, overlayFrameId: null })
  await sendToFrame(tabId, 0, { type: "prompt.show", token }).catch(() => {})
}

/** Vaults that can store a login for the page right now. */
export async function saveTargets(
  providers: Providers,
  page: URL,
): Promise<VaultInfo[]> {
  return (await providers.vaultsForPage(page)).filter(
    (vault) =>
      vault.status === "ready" && providers.providerOf(vault.id).canSave(page),
  )
}

export async function defaultTarget(
  targets: VaultInfo[],
): Promise<string | null> {
  const { defaultSaveTarget } = await getSettings()
  return (
    targets.find((t) => t.id === defaultSaveTarget)?.id ??
    targets[0]?.id ??
    null
  )
}

export async function promptState(
  providers: Providers,
  tabId: number,
): Promise<PromptState> {
  const session = await prompts.get(tabId)
  if (!session) throw new VaultError("Nothing to show", "overlay.closed")
  const page = new URL(session.url)
  const targets =
    session.mode === "save" ? await saveTargets(providers, page) : []
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

export async function confirmPrompt(
  providers: Providers,
  tabId: number,
  targetId: string | null,
): Promise<void> {
  const session = await prompts.get(tabId)
  if (!session) throw new VaultError("Nothing to save", "overlay.closed")
  const url = new URL(session.url)
  const login = { url, username: session.username, password: session.password }
  const tab = { tabId, frameId: 0 }
  if (session.update) {
    const { vaultId, loginId } = session.update
    await providers.providerOf(vaultId).update(vaultId, loginId, login, tab)
  } else {
    const targets = await saveTargets(providers, url)
    const target = targets.find((t) => t.id === targetId)
    if (!target)
      throw new VaultError("The chosen place is not available", "unknownVault")
    await providers.providerOf(target.id).save(target.id, login, tab)
  }
  await closePrompt(tabId)
}

/** Stops asking to save logins on the prompt's site. */
export async function neverForSite(tabId: number): Promise<void> {
  const session = await prompts.get(tabId)
  if (!session) return
  const host = new URL(session.url).hostname
  const { siteRules } = await getSettings()
  const existing = siteRules.find((r) => r.host === host)
  await updateSettings({
    siteRules: existing
      ? siteRules.map((r) =>
          r === existing ? { ...r, behavior: "noSave" } : r,
        )
      : [
          ...siteRules,
          {
            id: crypto.randomUUID(),
            host,
            match: null,
            provider: "all",
            behavior: "noSave",
          },
        ],
  })
  await closePrompt(tabId)
}

export async function closePrompt(tabId: number): Promise<void> {
  await prompts.remove(tabId)
  await sendToFrame(tabId, 0, { type: "prompt.close" }).catch(() => {})
}

import { ruleForHost } from "@/lib/matching"
import type { BitwardenProvider } from "@/lib/providers/bitwarden/bitwarden-provider"
import { accountIdOfVault } from "@/lib/providers/bitwarden/vault-id"
import {
  type Folder,
  type NewLogin,
  VaultError,
  type VaultInfo,
} from "@/lib/providers/types"
import {
  getSettings,
  type Settings,
  type SiteRule,
  updateSettings,
} from "@/lib/settings"
import { siteDomainOf } from "@/lib/site"
import type { PromptState } from "./api"
import { filledLoginMatching, isFilledPassword } from "./filled-logins"
import { MAX_TEXT_LENGTH } from "./limits"
import { type PromptSession, promptSessions } from "./overlays"
import { frameUrl, sendToFrame } from "./page"
import { openPopup } from "./popup-window"
import type { Providers } from "./providers"
import { forgetGenerated, pageKeyOf, recallGenerated } from "./recent-generated"
import { recallUsername, rememberUsername } from "./recent-usernames"
import { defaultTarget, promptTargets } from "./save-targets"

/** A save prompt shows again on pages loaded within this time after the login, until it is answered. */
const PROMPT_TTL_MS = 3 * 60_000

export interface SubmittedLoginInput {
  username: string
  password: string
  /** Whether `password` was typed into a field for a new password. */
  newPassword?: boolean
  /** Current password submitted beside a new password on a change-password form. */
  currentPassword?: string
  /** The account the page names without a field for it. */
  usernameOnPage?: string
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
 * Matches a change-password form's current password against the tab's recently filled login or
 * ready vaults' saved logins for the page, identifying the account even on multi-account sites.
 */
async function matchByCurrentPassword(
  providers: Providers,
  readyVaults: VaultInfo[],
  tabId: number,
  page: URL,
  currentPassword: string,
): Promise<{ username: string; login: StoredLogin } | null> {
  const site = siteDomainOf(page.hostname)
  const readyIds = new Set(readyVaults.map((vault) => vault.id))
  const pageViews = await providers.loginsForPage(page)

  const filled = await filledLoginMatching(tabId, site, currentPassword)
  if (filled && readyIds.has(filled.vaultId)) {
    const view = pageViews.find((candidate) => candidate.id === filled.vaultId)
    const login = view?.logins.find(
      (candidate) => candidate.id === filled.loginId,
    )
    if (login) return { username: login.username, login: filled }
  }

  const matches: { username: string; login: StoredLogin }[] = []
  for (const view of pageViews) {
    if (!readyIds.has(view.id)) continue
    const provider = providers.providerOf(view.id)
    for (const login of view.logins) {
      if (!login.username) continue
      const existing = await provider
        .findExisting(view.id, page, login.username, currentPassword)
        .catch(() => null)
      if (existing?.samePassword === true && existing.editable !== false) {
        matches.push({
          username: login.username,
          login: { vaultId: view.id, loginId: existing.loginId },
        })
      }
    }
  }
  return matches.length === 1 ? (matches[0] ?? null) : null
}

/**
 * Compares a submitted login with the vaults. It counts as unchanged when a vault has it with this
 * password, when a vault cannot tell and the password was not typed as a new one, or when the
 * vaults that have it are ones Keyward may not change, so it is neither updated nor saved a second
 * time. Apple Passwords does not reveal a password without Touch ID; a login Keyward filled in the
 * tab moments ago is compared with what it filled instead.
 */
async function holdingOf(
  providers: Providers,
  vaults: VaultInfo[],
  tabId: number,
  page: URL,
  account: string,
  password: string,
  isNewPassword: boolean,
): Promise<Holding> {
  const site = siteDomainOf(page.hostname)
  let changed: StoredLogin | null = null
  let keptUnchangeable = false
  for (const vault of vaults) {
    const existing = await providers
      .providerOf(vault.id)
      .findExisting(vault.id, page, account, password)
      .catch(() => null)
    if (!existing) continue
    const samePassword =
      existing.samePassword ??
      (await isFilledPassword(
        tabId,
        site,
        vault.id,
        existing.loginId,
        password,
      ))
    if (samePassword === true) return { kind: "unchanged" }
    if (samePassword === undefined && !isNewPassword)
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

interface ReadyDecision {
  mode: "save" | "update"
  username: string
  password: string
  update: StoredLogin | null
}

/**
 * Evaluates the (username, currentPassword, newPassword) matrix against ready vaults and settings.
 * Returns null when the login is unchanged, lacks an identifiable account, or prompts are disabled.
 */
async function evaluateReadySubmission(
  providers: Providers,
  readyVaults: VaultInfo[],
  settings: Settings,
  tabId: number,
  page: URL,
  params: {
    username: string
    password: string
    isNewPassword: boolean
    currentPassword: string
  },
): Promise<ReadyDecision | null> {
  const { password, isNewPassword, currentPassword } = params
  let account = params.username
  let directUpdate: StoredLogin | null = null

  if (!account) {
    // (-, P, -): password-only login without a username stays quiet.
    if (!isNewPassword) return null
    // (-, P, N): change-password form without a username field.
    if (currentPassword) {
      if (currentPassword === password) return null
      const matched = await matchByCurrentPassword(
        providers,
        readyVaults,
        tabId,
        page,
        currentPassword,
      )
      if (matched) {
        account = matched.username
        directUpdate = matched.login
      }
    }
    // (-, -, N) or fallback for (-, P, N): single saved account on this site.
    if (!account) account = await onlyUsername(providers, page)
    if (!account) return null
  }

  // (U, P, N) where current and new passwords are equal: treat as a regular login check.
  const effectiveNewPassword =
    isNewPassword && (!currentPassword || currentPassword !== password)

  const holding = await holdingOf(
    providers,
    readyVaults,
    tabId,
    page,
    account,
    password,
    effectiveNewPassword,
  )
  if (holding.kind === "unchanged") return null
  let update: StoredLogin | null = null
  if (holding.kind === "changed") update = holding.login
  else if (effectiveNewPassword) update = directUpdate
  const userWantsPrompt = update ? settings.askUpdate : settings.askSave
  if (!userWantsPrompt) return null
  if (!update && !(await promptTargets(providers, page)).length) return null

  return {
    mode: update ? "update" : "save",
    username: account,
    password,
    update,
  }
}

/** Handles a login form the user submitted: offers to save a login no vault has, or to update one. */
export async function onSubmitted(
  providers: Providers,
  tabId: number,
  frameId: number,
  submitted: SubmittedLoginInput,
  knownPage?: URL,
): Promise<void> {
  if (
    submitted.username.length > MAX_TEXT_LENGTH ||
    submitted.password.length > MAX_TEXT_LENGTH ||
    (submitted.currentPassword?.length ?? 0) > MAX_TEXT_LENGTH
  )
    return
  const page = knownPage ?? (await frameUrl(tabId, frameId))
  if (!page) return
  const settings = await getSettings()
  const behavior = ruleForHost(settings.siteRules, page.hostname)?.behavior
  if (behavior === "noSave" || behavior === "disabled") return
  const site = siteDomainOf(page.hostname)
  // The username this tab used on the step before is surer than the one the page names.
  const username =
    submitted.username.trim() ||
    (await recallUsername(tabId, site)) ||
    submitted.usernameOnPage?.trim() ||
    ""

  const generated = await recallGenerated(tabId, site)
  const recoveredGenerated =
    !submitted.password &&
    Boolean(username) &&
    generated?.filled === true &&
    generated.pageKey === pageKeyOf(page)
  const password = recoveredGenerated
    ? (generated?.password ?? "")
    : submitted.password
  const isNewPassword =
    submitted.newPassword === true ||
    recoveredGenerated ||
    (Boolean(password) && generated?.password === password)
  const currentPassword = submitted.currentPassword ?? ""

  // (U, -, -): step 1 of a two-step login.
  if (!password) {
    if (username) await rememberUsername(tabId, site, username)
    return
  }

  const pageVaults = await providers.vaultsForPage(page)
  const readyVaults = pageVaults.filter((vault) => vault.status === "ready")

  const openSaveSession = async (session: {
    mode: PromptSession["mode"]
    username: string
    password: string
    update: StoredLogin | null
  }) => {
    await promptSessions.set({
      tabId,
      frameId: 0,
      token: crypto.randomUUID(),
      overlayFrameId: null,
      mode: session.mode,
      url: page.href,
      username: session.username,
      password: session.password,
      newPassword: isNewPassword,
      currentPassword: currentPassword || undefined,
      update: session.update,
      pendingAutoSave: null,
      createdAt: Date.now(),
    })
    await showPrompt(tabId)
  }

  if (!readyVaults.length) {
    const lockedVaults = pageVaults.filter(
      (vault) =>
        vault.status === "locked" &&
        providers.providerOf(vault.id).canSave(page),
    )
    if (!lockedVaults.length || (!settings.askSave && !settings.askUpdate))
      return
    if (!username && !isNewPassword) return
    await openSaveSession({
      mode: "locked",
      username,
      password,
      update: null,
    })
    return
  }

  const decision = await evaluateReadySubmission(
    providers,
    readyVaults,
    settings,
    tabId,
    page,
    {
      username,
      password,
      isNewPassword,
      currentPassword,
    },
  )
  if (!decision) return
  await openSaveSession(decision)
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
  const pageVaults = await providers.vaultsForPage(page)
  const targets =
    session.mode === "save" ? await promptTargets(providers, page) : []
  const lockedVaults =
    session.mode === "locked"
      ? pageVaults.filter(
          (vault) =>
            vault.status === "locked" &&
            providers.providerOf(vault.id).canSave(page),
        )
      : []
  const updateVault = session.update
    ? await providers.vault(session.update.vaultId).catch(() => null)
    : null
  return {
    mode: session.mode,
    username: session.username,
    password: session.password,
    host: page.hostname,
    targets,
    defaultTarget: await defaultTarget(targets),
    lockedVaults,
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

function editedCredentials(
  session: PromptSession,
  overrides: { username?: string; password?: string },
): { username: string; password: string } {
  const username =
    overrides.username !== undefined
      ? overrides.username.trim()
      : session.username
  const password =
    overrides.password !== undefined ? overrides.password : session.password
  if (
    username.length > MAX_TEXT_LENGTH ||
    password.length > MAX_TEXT_LENGTH ||
    !password
  )
    throw new VaultError("Invalid credentials", "invalidInput")
  return { username, password }
}

export async function confirmPrompt(
  providers: Providers,
  session: PromptSession,
  targetId: string | null,
  choices: {
    name: string
    folderId: string | null
    username?: string
    password?: string
  } = {
    name: "",
    folderId: null,
  },
): Promise<void> {
  const url = new URL(session.url)
  const { username, password } = editedCredentials(session, choices)
  const login: NewLogin = {
    url,
    username,
    password,
    details: {
      name: choices.name,
      folderId: choices.folderId,
      notes: "",
      totp: "",
      customFields: [],
    },
  }
  if (session.update) {
    const { vaultId, loginId } = session.update
    await providers.providerOf(vaultId).update(vaultId, loginId, login)
  } else {
    const targets = await promptTargets(providers, url)
    const target = targets.find((candidate) => candidate.id === targetId)
    if (!target)
      throw new VaultError("The chosen place is not available", "unknownVault")
    await providers.providerOf(target.id).save(target.id, login)
  }
  await forgetGenerated(session.tabId)
  await closePrompt(session.tabId)
}

/** Saves or updates a deferred locked-vault prompt once its target vault is unlocked. */
async function completeDeferredSave(
  providers: Providers,
  session: PromptSession,
  vaultId: string,
  name: string,
): Promise<void> {
  const page = new URL(session.url)
  const readyVaults = (await providers.vaultsForPage(page)).filter(
    (vault) => vault.status === "ready",
  )
  const settings = await getSettings()
  const decision = await evaluateReadySubmission(
    providers,
    readyVaults,
    settings,
    session.tabId,
    page,
    {
      username: session.username,
      password: session.password,
      isNewPassword: session.newPassword === true,
      currentPassword: session.currentPassword ?? "",
    },
  )
  if (!decision) {
    await forgetGenerated(session.tabId)
    await closePrompt(session.tabId)
    return
  }
  const login: NewLogin = {
    url: page,
    username: decision.username,
    password: decision.password,
    details: { name, folderId: null, notes: "", totp: "", customFields: [] },
  }
  if (decision.update) {
    await providers
      .providerOf(decision.update.vaultId)
      .update(decision.update.vaultId, decision.update.loginId, login)
  } else {
    const targets = await promptTargets(providers, page)
    const chosen =
      targets.find((candidate) => candidate.id === vaultId) ?? targets[0]
    if (!chosen)
      throw new VaultError("The chosen place is not available", "unknownVault")
    await providers.providerOf(chosen.id).save(chosen.id, login)
  }
  await forgetGenerated(session.tabId)
  await closePrompt(session.tabId)
}

/**
 * Triggers unlocking from a locked save prompt. When a Bitwarden master password is given, unlocks
 * inline and completes the save immediately; otherwise records the auto-save intent and opens the
 * popup's connect/unlock screen so the save runs as soon as the vault becomes ready.
 */
export async function unlockAndSavePrompt(
  providers: Providers,
  bitwarden: BitwardenProvider,
  session: PromptSession,
  options: {
    vaultId: string
    masterPassword?: string
    username?: string
    password?: string
    name?: string
  },
): Promise<{ completed: boolean }> {
  const page = new URL(session.url)
  const vault = (await providers.vaultsForPage(page)).find(
    (candidate) => candidate.id === options.vaultId,
  )
  if (!vault) throw new VaultError("Unknown vault", "unknownVault")
  const { username, password } = editedCredentials(session, options)
  const updated: PromptSession = {
    ...session,
    username,
    password,
    pendingAutoSave: null,
  }
  const name = options.name ?? ""

  if (vault.status === "ready") {
    await completeDeferredSave(providers, updated, vault.id, name)
    return { completed: true }
  }

  if (vault.kind === "bitwarden" && options.masterPassword) {
    const accountId = accountIdOfVault(vault.id)
    if (!accountId) throw new VaultError("Unknown vault", "unknownVault")
    await bitwarden.unlock(accountId, options.masterPassword)
    await completeDeferredSave(providers, updated, vault.id, name)
    return { completed: true }
  }

  await promptSessions.set({
    ...updated,
    pendingAutoSave: { vaultId: vault.id, name, folderId: null },
  })
  await openPopup({
    name: "connect",
    kind: vault.kind,
    vaultId: vault.id,
  })
  return { completed: false }
}

/**
 * Re-evaluates locked prompts whenever vaults become ready: completes pending auto-saves triggered
 * from the prompt, or transitions externally unlocked prompts to save/update (or closes them if
 * the login is already stored unchanged).
 */
export async function refreshLockedPrompts(
  providers: Providers,
): Promise<void> {
  const sessions = await promptSessions.all()
  for (const session of sessions) {
    if (session.mode !== "locked") continue
    if (Date.now() - session.createdAt > PROMPT_TTL_MS) {
      await promptSessions.remove(session.tabId)
      continue
    }
    const page = new URL(session.url)
    const readyVaults = (await providers.vaultsForPage(page)).filter(
      (vault) => vault.status === "ready",
    )
    if (!readyVaults.length) continue

    const pending = session.pendingAutoSave
    if (pending && readyVaults.some((vault) => vault.id === pending.vaultId)) {
      await promptSessions.set({ ...session, pendingAutoSave: null })
      try {
        await completeDeferredSave(
          providers,
          session,
          pending.vaultId,
          pending.name,
        )
        continue
      } catch {
        // Fall through to show the ready prompt so the user can finish or fix the details.
      }
    }

    const settings = await getSettings()
    const decision = await evaluateReadySubmission(
      providers,
      readyVaults,
      settings,
      session.tabId,
      page,
      {
        username: session.username,
        password: session.password,
        isNewPassword: session.newPassword === true,
        currentPassword: session.currentPassword ?? "",
      },
    )
    if (!decision) {
      await closePrompt(session.tabId)
      continue
    }
    await promptSessions.set({
      ...session,
      mode: decision.mode,
      username: decision.username,
      password: decision.password,
      update: decision.update,
      pendingAutoSave: null,
    })
    await showPrompt(session.tabId)
  }
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

import { resolveLanguage } from "@/lib/i18n/language"
import { ruleForHost } from "@/lib/matching"
import { VaultError } from "@/lib/providers/types"
import { getSettings, type Settings } from "@/lib/settings"
import { siteDomainOf } from "@/lib/site"
import type { ContentConfig, FieldInfo } from "./api"
import { addHistory } from "./history"
import { activeTab, frameUrl, sendToFrame } from "./page"
import { hasPasskeySite, rememberPasskeySite } from "./passkey-sites"
import type { Providers } from "./providers"
import { markRecent, recallUsername, rememberUsername } from "./save-flow"

/** Whether a frame may show the field icon and receive logins, given its URL and the settings. */
async function frameAllowed(
  tabId: number,
  frameId: number,
  page: URL,
  settings: Settings,
): Promise<boolean> {
  if (ruleForHost(settings.siteRules, page.hostname)?.behavior === "disabled")
    return false
  if (frameId === 0 || settings.crossOriginFrames) return true
  const top = await frameUrl(tabId, 0)
  return top?.origin === page.origin
}

export async function contentConfig(
  providers: Providers,
  tabId: number,
  frameId: number,
): Promise<ContentConfig> {
  const settings = await getSettings()
  const page = await frameUrl(tabId, frameId)
  const off: ContentConfig = {
    active: false,
    scanCodes: false,
    menuTrigger: settings.menuTrigger,
    takeOverPasskeys: false,
    theme: settings.theme,
    language: resolveLanguage(settings.language),
  }
  if (!page || !(await frameAllowed(tabId, frameId, page, settings))) return off
  if (!(await providers.vaultsForPage(page)).length) return off
  const behavior = ruleForHost(settings.siteRules, page.hostname)?.behavior
  const menuTrigger =
    behavior === "menuOnFocus"
      ? "focus"
      : behavior === "menuOnClick"
        ? "click"
        : settings.menuTrigger
  const scanCodes = (await providers.vaults()).some(
    (vault) =>
      vault.status === "ready" &&
      (vault.kind === "bitwarden" || providers.apple.canSetUpCodes()),
  )
  const takeOverPasskeys =
    settings.takeOverPasskeys && (await hasPasskeySite(page))
  return { ...off, active: true, menuTrigger, scanCodes, takeOverPasskeys }
}

/** Notes that the frame's site has a passkey, once the frame may show the menu at all. */
export async function notePasskeyUsed(
  tabId: number,
  frameId: number,
): Promise<void> {
  const page = await frameUrl(tabId, frameId)
  if (page && (await frameAllowed(tabId, frameId, page, await getSettings())))
    await rememberPasskeySite(page)
}

/** The frame's page, once it is known that the frame may be filled from the vault. */
async function fillablePage(
  providers: Providers,
  tabId: number,
  frameId: number,
  vaultId: string,
): Promise<{ page: URL; settings: Settings }> {
  const settings = await getSettings()
  const page = await frameUrl(tabId, frameId)
  if (!page) throw new VaultError("The frame is not a web page", "notWebPage")
  if (!(await frameAllowed(tabId, frameId, page, settings))) {
    throw new VaultError("Filling is turned off for this frame", "fillDisabled")
  }
  if (
    !(await providers.vaultsForPage(page)).some((vault) => vault.id === vaultId)
  ) {
    throw new VaultError("The vault does not serve this site", "unknownVault")
  }
  return { page, settings }
}

/** Reading a secret can wait for Touch ID, during which the frame may have navigated. */
async function requireSameOrigin(
  tabId: number,
  frameId: number,
  page: URL,
): Promise<void> {
  const current = await frameUrl(tabId, frameId)
  if (current?.origin !== page.origin)
    throw new VaultError("The page changed", "pageChanged")
}

/**
 * Sends a login to one frame. The vault must serve the frame's site and the provider checks that
 * the login matches the frame's URL; the content script fills only if its origin is still the one
 * checked here.
 */
export async function fillLogin(
  providers: Providers,
  tabId: number,
  frameId: number,
  vaultId: string,
  loginId: string,
): Promise<void> {
  const { page, settings } = await fillablePage(
    providers,
    tabId,
    frameId,
    vaultId,
  )
  const credential = await providers
    .providerOf(vaultId)
    .credential(vaultId, loginId, page, { tabId, frameId })
  await requireSameOrigin(tabId, frameId, page)
  await sendToFrame(tabId, frameId, {
    type: "fill",
    origin: page.origin,
    username: credential.username,
    password: credential.password,
    autoSubmit: settings.autoSubmit,
  })
  // A one-time code page that follows offers this login's code first.
  if (credential.username)
    await rememberUsername(
      tabId,
      siteDomainOf(page.hostname),
      credential.username,
    )
}

/** Sends a login's current one-time code to one frame, with the same checks as `fillLogin`. */
export async function fillCode(
  providers: Providers,
  tabId: number,
  frameId: number,
  vaultId: string,
  loginId: string,
): Promise<void> {
  const { page } = await fillablePage(providers, tabId, frameId, vaultId)
  const { code } = await providers
    .providerOf(vaultId)
    .oneTimeCode(vaultId, loginId, page, { tabId, frameId })
  await requireSameOrigin(tabId, frameId, page)
  await sendToFrame(tabId, frameId, {
    type: "fillCode",
    origin: page.origin,
    code,
  })
}

/**
 * Sends a generated password to the frame's new-password fields. It goes into the generator's
 * history first, so it is not lost if the page keeps it but the login is never saved.
 */
export async function fillNewPassword(
  tabId: number,
  frameId: number,
  password: string,
): Promise<void> {
  const settings = await getSettings()
  const page = await frameUrl(tabId, frameId)
  if (!page) throw new VaultError("The frame is not a web page", "notWebPage")
  if (!(await frameAllowed(tabId, frameId, page, settings)))
    throw new VaultError("Filling is turned off for this frame", "fillDisabled")
  await addHistory(password, page.hostname)
  await sendToFrame(tabId, frameId, {
    type: "fillNew",
    origin: page.origin,
    password,
  })
}

/**
 * Whether code fields of the frame get the icon: when a ready vault offers codes for the page,
 * or when no vault is ready yet, so the menu can offer pairing and unlocking.
 */
export async function hasCodes(
  providers: Providers,
  tabId: number,
  frameId: number,
): Promise<boolean> {
  const settings = await getSettings()
  const page = await frameUrl(tabId, frameId)
  if (!page || !(await frameAllowed(tabId, frameId, page, settings)))
    return false
  const views = await providers.codeLoginsForPage(page, { tabId, frameId })
  if (!views.some((view) => view.status === "ready")) return views.length > 0
  return views.some((view) => view.logins.length > 0)
}

/**
 * Fills the first matching login into the frame with the focused login field, else the top frame.
 * "noLogin" means the page has a login field but no ready vault has a login for it.
 */
export async function fillFirst(
  providers: Providers,
): Promise<"filled" | "noField" | "noLogin"> {
  const tab = await activeTab()
  if (tab?.id === undefined) return "noField"
  const tabId = tab.id
  const frames = (await browser.webNavigation.getAllFrames({ tabId })) ?? []
  const infos = await Promise.all(
    frames.map((frame) =>
      sendToFrame<FieldInfo>(tabId, frame.frameId, { type: "fieldInfo" }).then(
        (info) =>
          info?.hasField
            ? { frameId: frame.frameId, focused: info.focused }
            : null,
        () => null,
      ),
    ),
  )
  const candidates = infos.filter((info) => info !== null)
  const target =
    candidates.find((c) => c.focused) ??
    candidates.find((c) => c.frameId === 0) ??
    candidates[0]
  if (!target) return "noField"
  const page = await frameUrl(tabId, target.frameId)
  if (!page) return "noField"
  // On the password step of a two-step login, the account typed on the first step is the one.
  const views = markRecent(
    await providers.loginsForPage(page),
    await recallUsername(tabId, siteDomainOf(page.hostname)),
  )
  for (const view of views) {
    const login = view.logins[0]
    if (login) {
      await fillLogin(providers, tabId, target.frameId, view.id, login.id)
      return "filled"
    }
  }
  return "noLogin"
}

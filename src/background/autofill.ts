import { storage } from "wxt/utils/storage"
import { generatePassword, getGeneratorOptions } from "@/lib/generator"
import { resolveLanguage } from "@/lib/i18n/language"
import { ruleForHost } from "@/lib/matching"
import { fieldRulesFrom, passwordLimitsFor } from "@/lib/password-rules"
import { VaultError } from "@/lib/providers/types"
import { serialQueue } from "@/lib/serial-queue"
import { getSettings, type Settings, type SiteBehavior } from "@/lib/settings"
import { siteDomainOf } from "@/lib/site"
import type { ContentConfig, ContentMessage, FieldInfo } from "./api"
import { rememberFill } from "./filled-logins"
import { addHistory } from "./history"
import {
  activeTab,
  type FrameDocument,
  frameDocument,
  frameUrl,
  sendToDocument,
  sendToFrame,
} from "./page"
import { type Providers, vaultsForRule } from "./providers"
import {
  markRecent,
  recallUsername,
  rememberUsername,
} from "./recent-usernames"

/**
 * Whether a frame may show the field icon and receive logins, given its URL and the settings. A
 * frame of the page's own site counts as the page, as a sign-in form on another of its subdomains
 * does; logins are matched to the frame's own address either way.
 */
async function frameAllowed(
  tabId: number,
  frameId: number,
  page: URL,
  settings: Settings,
): Promise<boolean> {
  if (ruleForHost(settings.siteRules, page.hostname)?.behavior === "disabled")
    return false
  if (frameId === 0 || settings.crossSiteFrames) return true
  const top = await frameUrl(tabId, 0)
  return (
    top !== null && siteDomainOf(top.hostname) === siteDomainOf(page.hostname)
  )
}

/** The frame's page, when the frame may show the field icon and receive logins; null otherwise. */
async function allowedPage(
  tabId: number,
  frameId: number,
  settings: Settings,
): Promise<URL | null> {
  const page = await frameUrl(tabId, frameId)
  if (!page || !(await frameAllowed(tabId, frameId, page, settings)))
    return null
  return page
}

/** The frame's document, whose page must be one Keyward may fill; the error says why it may not. */
async function requireFillableDocument(
  tabId: number,
  frameId: number,
  settings: Settings,
): Promise<FrameDocument> {
  const target = await frameDocument(tabId, frameId)
  if (!target) throw new VaultError("The frame is not a web page", "notWebPage")
  if (!(await frameAllowed(tabId, frameId, target.page, settings)))
    throw new VaultError("Filling is turned off for this frame", "fillDisabled")
  return target
}

/** When the in-page menu opens: as the site's rule says, else as the settings say. */
function menuTriggerFor(
  behavior: SiteBehavior | undefined,
  fallback: Settings["menuTrigger"],
): Settings["menuTrigger"] {
  if (behavior === "menuOnFocus") return "focus"
  if (behavior === "menuOnClick") return "click"
  if (behavior === "menuOff") return "off"
  return fallback
}

export async function contentConfig(
  providers: Providers,
  tabId: number,
  frameId: number,
): Promise<ContentConfig> {
  const settings = await getSettings()
  const off: ContentConfig = {
    active: false,
    scanCodes: false,
    menuTrigger: settings.menuTrigger,
    takeOverPasskeys: false,
    theme: settings.theme,
    language: resolveLanguage(settings.language),
  }
  const page = await allowedPage(tabId, frameId, settings)
  if (!page) return off
  const rule = ruleForHost(settings.siteRules, page.hostname)
  const vaults = await providers.vaults()
  if (!vaultsForRule(vaults, rule).length) return off
  const scanCodes = vaults.some(
    (vault) =>
      vault.status === "ready" &&
      Boolean(providers.providerOf(vault.id).codeSetup?.(vault.id, page)),
  )
  const menuTrigger = menuTriggerFor(rule?.behavior, settings.menuTrigger)
  // A passkey request kept for the menu would wait for a menu that never opens.
  const takeOverPasskeys = menuTrigger !== "off" && settings.takeOverPasskeys
  return {
    ...off,
    active: true,
    menuTrigger,
    scanCodes,
    takeOverPasskeys,
  }
}

/** The frame's document, once it is known that the frame may be filled from the vault. */
async function fillableDocument(
  providers: Providers,
  tabId: number,
  frameId: number,
  vaultId: string,
): Promise<{ target: FrameDocument; settings: Settings }> {
  const settings = await getSettings()
  const target = await requireFillableDocument(tabId, frameId, settings)
  if (
    !(await providers.vaultsForPage(target.page)).some(
      (vault) => vault.id === vaultId,
    )
  ) {
    throw new VaultError("The vault does not serve this site", "unknownVault")
  }
  return { target, settings }
}

/**
 * Sends a secret to the document that was checked, and to no later one: reading the secret can
 * wait for Touch ID, during which the frame may have navigated to another page.
 */
async function sendToChecked<T>(
  tabId: number,
  frameId: number,
  target: FrameDocument,
  message: ContentMessage,
): Promise<T> {
  try {
    return await sendToDocument<T>(tabId, target.documentId, message)
  } catch (error) {
    const current = await frameDocument(tabId, frameId)
    if (current?.documentId !== target.documentId)
      throw new VaultError("The page changed", "pageChanged")
    throw error
  }
}

/**
 * Sends a login to one frame. The vault must serve the frame's site and the provider checks that
 * the login matches the frame's URL; the login goes only to the document checked here, and its
 * content script fills only if its origin is still the one checked.
 */
export async function fillLogin(
  providers: Providers,
  tabId: number,
  frameId: number,
  vaultId: string,
  loginId: string,
): Promise<void> {
  const { target, settings } = await fillableDocument(
    providers,
    tabId,
    frameId,
    vaultId,
  )
  const { page } = target
  const credential = await providers
    .providerOf(vaultId)
    .credential(vaultId, loginId, page)
  await sendToChecked(tabId, frameId, target, {
    type: "fill",
    origin: page.origin,
    username: credential.username,
    password: credential.password,
    fields: credential.fields ?? [],
    autoSubmit: settings.autoSubmit,
  })
  const site = siteDomainOf(page.hostname)
  // A login submitted next is checked against this password, which Passwords cannot do itself.
  if (credential.password)
    await rememberFill(tabId, site, vaultId, loginId, credential.password)
  // A one-time code page that follows offers this login's code first.
  if (credential.username)
    await rememberUsername(tabId, site, credential.username)
}

/** Sends a login's current one-time code to one frame, with the same checks as `fillLogin`. */
export async function fillCode(
  providers: Providers,
  tabId: number,
  frameId: number,
  vaultId: string,
  loginId: string,
): Promise<void> {
  const { target } = await fillableDocument(providers, tabId, frameId, vaultId)
  const { code } = await providers
    .providerOf(vaultId)
    .oneTimeCode(vaultId, loginId, target.page, { tabId, frameId })
  await sendToChecked(tabId, frameId, target, {
    type: "fillCode",
    origin: target.page.origin,
    code,
  })
}

/**
 * Sends a generated password to the frame's new-password fields. It goes into the generator's
 * history first, so it is not lost if the page keeps it but the login is never saved. Resolves to
 * whether the frame found a field for it.
 */
export async function fillNewPassword(
  tabId: number,
  frameId: number,
  password: string,
): Promise<boolean> {
  const target = await requireFillableDocument(
    tabId,
    frameId,
    await getSettings(),
  )
  await addHistory(password, target.page.hostname)
  const filled = await sendToChecked<boolean | null>(tabId, frameId, target, {
    type: "fillNew",
    origin: target.page.origin,
    password,
  })
  return filled === true
}

/**
 * A generated password for the frame's new-password fields: the generator's options within what
 * the fields and the site allow, as the frame's content script reads the fields' rules.
 */
export async function passwordForFrame(
  tabId: number,
  frameId: number,
): Promise<string> {
  const page = await frameUrl(tabId, frameId)
  const rules = await sendToFrame<unknown>(tabId, frameId, {
    type: "newPasswordRules",
  }).catch(() => null)
  const limits = page
    ? passwordLimitsFor(page.hostname, fieldRulesFrom(rules))
    : null
  return generatePassword(await getGeneratorOptions(), limits)
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
  const page = await allowedPage(tabId, frameId, await getSettings())
  if (!page) return false
  const views = await providers.codeLoginsForPage(page, { tabId, frameId })
  if (!views.some((view) => view.status === "ready")) return views.length > 0
  return views.some((view) => view.logins.length > 0)
}

/** The fill shortcut's last press, so the next press on the same page fills the next login. */
const fillCycleItem = storage.defineItem<FillCycle>("session:autofill.cycle")
/**
 * Presses further apart than this start again from the first login, so coming back to a login
 * page later does not pick up where an earlier visit left off. Keyward's choice.
 */
const FILL_CYCLE_MS = 30_000

interface FillCycle {
  tabId: number
  /** The page's origin and path; another page starts again. */
  page: string
  /** The logins in the order the first press found them, as keys from `cycleKeyOf`. */
  order: string[]
  /** The position in `order` of the login filled last. */
  index: number
  at: number
}

function cycleKeyOf(vaultId: string, loginId: string): string {
  return JSON.stringify([vaultId, loginId])
}

/** Steps of the fill cycle run one after another, so quick presses each advance. */
const cycleTurn = serialQueue()

/**
 * The login the shortcut fills: the first one, or the one after the last press's while the same
 * page is pressed again soon. The order is kept from the first press, as filling one login moves
 * it to the front of later lists.
 */
function nextInCycle(
  tabId: number,
  page: URL,
  available: string[],
): Promise<string | undefined> {
  return cycleTurn(() => advanceCycle(tabId, page, available))
}

async function advanceCycle(
  tabId: number,
  page: URL,
  available: string[],
): Promise<string | undefined> {
  const pageKey = `${page.origin}${page.pathname}`
  const stored = await fillCycleItem.getValue()
  const now = Date.now()
  const continues =
    stored !== null &&
    stored.tabId === tabId &&
    stored.page === pageKey &&
    now - stored.at < FILL_CYCLE_MS
  const order = continues
    ? [
        ...stored.order.filter((key) => available.includes(key)),
        ...available.filter((key) => !stored.order.includes(key)),
      ]
    : available
  const last = continues ? order.indexOf(stored.order[stored.index] ?? "") : -1
  const index = order.length ? (last + 1) % order.length : 0
  const next = order[index]
  if (next !== undefined) {
    const cycle: FillCycle = { tabId, page: pageKey, order, index, at: now }
    await fillCycleItem.setValue(cycle)
  }
  return next
}

/** The frame the fill shortcut fills: the one with a focused login field, else the top frame, else any with one. */
async function targetFrame(tabId: number): Promise<number | null> {
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
  const withField = infos.filter((info) => info !== null)
  const target =
    withField.find((frame) => frame.focused) ??
    withField.find((frame) => frame.frameId === 0) ??
    withField[0]
  return target?.frameId ?? null
}

/**
 * Fills a matching login into the frame with the focused login field, else the top frame: the
 * first one, and on each further press soon after, the next. "noLogin" means the page has a login
 * field but no ready vault has a login for it.
 */
export async function fillFirst(
  providers: Providers,
): Promise<"filled" | "noField" | "noLogin"> {
  const tab = await activeTab()
  if (tab?.id === undefined) return "noField"
  const tabId = tab.id
  const target = await targetFrame(tabId)
  if (target === null) return "noField"
  const page = await frameUrl(tabId, target)
  if (!page) return "noField"
  // On the password step of a two-step login, the account typed on the first step is the one.
  const views = markRecent(
    await providers.loginsForPage(page),
    await recallUsername(tabId, siteDomainOf(page.hostname)),
  )
  const available = views.flatMap((view) =>
    view.logins.map((login) => cycleKeyOf(view.id, login.id)),
  )
  const next = await nextInCycle(tabId, page, available)
  if (next === undefined) return "noLogin"
  const [vaultId, loginId] = JSON.parse(next) as [string, string]
  await fillLogin(providers, tabId, target, vaultId, loginId)
  return "filled"
}

import { BackendError } from "@/lib/backends/types"
import { resolveLanguage } from "@/lib/i18n/language"
import { ruleForHost } from "@/lib/matching"
import { getSettings, type Settings } from "@/lib/settings"
import type { ContentConfig, FieldInfo } from "./api"
import type { Backends } from "./backends"
import { activeTab, frameUrl, sendToFrame } from "./page"

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
  backends: Backends,
  tabId: number,
  frameId: number,
): Promise<ContentConfig> {
  const settings = await getSettings()
  const page = await frameUrl(tabId, frameId)
  const off: ContentConfig = {
    active: false,
    menuTrigger: settings.menuTrigger,
    theme: settings.theme,
    language: resolveLanguage(settings.language),
  }
  if (!page || !(await frameAllowed(tabId, frameId, page, settings))) return off
  if (!(await backends.sourcesForPage(page)).length) return off
  const behavior = ruleForHost(settings.siteRules, page.hostname)?.behavior
  const menuTrigger =
    behavior === "menuOnFocus"
      ? "focus"
      : behavior === "menuOnClick"
        ? "click"
        : settings.menuTrigger
  return { ...off, active: true, menuTrigger }
}

/** The frame's page, once it is known that the frame may be filled from the source. */
async function fillablePage(
  backends: Backends,
  tabId: number,
  frameId: number,
  sourceId: string,
): Promise<{ page: URL; settings: Settings }> {
  const settings = await getSettings()
  const page = await frameUrl(tabId, frameId)
  if (!page) throw new BackendError("The frame is not a web page", "notWebPage")
  if (!(await frameAllowed(tabId, frameId, page, settings))) {
    throw new BackendError(
      "Filling is turned off for this frame",
      "fillDisabled",
    )
  }
  if (!(await backends.sourcesForPage(page)).some((s) => s.id === sourceId)) {
    throw new BackendError(
      "The source does not serve this site",
      "unknownSource",
    )
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
    throw new BackendError("The page changed", "pageChanged")
}

/**
 * Sends a login to one frame. The source must serve the frame's site and the backend checks that
 * the login matches the frame's URL; the content script fills only if its origin is still the one
 * checked here.
 */
export async function fillLogin(
  backends: Backends,
  tabId: number,
  frameId: number,
  sourceId: string,
  loginId: string,
): Promise<void> {
  const { page, settings } = await fillablePage(
    backends,
    tabId,
    frameId,
    sourceId,
  )
  const credential = await backends
    .backendOf(sourceId)
    .credential(sourceId, loginId, page, { tabId, frameId })
  await requireSameOrigin(tabId, frameId, page)
  await sendToFrame(tabId, frameId, {
    type: "fill",
    origin: page.origin,
    username: credential.username,
    password: credential.password,
    autoSubmit: settings.autoSubmit,
  })
}

/** Sends a login's current one-time code to one frame, with the same checks as `fillLogin`. */
export async function fillCode(
  backends: Backends,
  tabId: number,
  frameId: number,
  sourceId: string,
  loginId: string,
): Promise<void> {
  const { page } = await fillablePage(backends, tabId, frameId, sourceId)
  const { code } = await backends
    .backendOf(sourceId)
    .oneTimeCode(sourceId, loginId, page, { tabId, frameId })
  await requireSameOrigin(tabId, frameId, page)
  await sendToFrame(tabId, frameId, {
    type: "fillCode",
    origin: page.origin,
    code,
  })
}

/** Whether a ready source offers one-time codes for the frame's page. */
export async function hasCodes(
  backends: Backends,
  tabId: number,
  frameId: number,
): Promise<boolean> {
  const settings = await getSettings()
  const page = await frameUrl(tabId, frameId)
  if (!page || !(await frameAllowed(tabId, frameId, page, settings)))
    return false
  const views = await backends.codeLoginsForPage(page, { tabId, frameId })
  return views.some((view) => view.logins.length > 0)
}

/**
 * Fills the first matching login into the frame with the focused login field, else the top frame.
 * "noLogin" means the page has a login field but no ready source has a login for it.
 */
export async function fillFirst(
  backends: Backends,
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
  const views = await backends.loginsForPage(page)
  for (const view of views) {
    const login = view.logins[0]
    if (login) {
      await fillLogin(backends, tabId, target.frameId, view.id, login.id)
      return "filled"
    }
  }
  return "noLogin"
}

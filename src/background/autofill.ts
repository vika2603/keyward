import { BackendError } from "@/lib/backends/types"
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
  return { active: true, menuTrigger, theme: settings.theme }
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
  const credential = await backends
    .backendOf(sourceId)
    .credential(sourceId, loginId, page, { tabId, frameId })
  // Reading a password can wait for Touch ID, during which the frame may have navigated.
  const current = await frameUrl(tabId, frameId)
  if (current?.origin !== page.origin)
    throw new BackendError("The page changed", "pageChanged")
  await sendToFrame(tabId, frameId, {
    type: "fill",
    origin: page.origin,
    username: credential.username,
    password: credential.password,
    autoSubmit: settings.autoSubmit,
  })
}

/** Fills the first matching login into the frame with the focused login field, else the top frame. */
export async function fillFirst(backends: Backends): Promise<void> {
  const tab = await activeTab()
  if (tab?.id === undefined) return
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
  if (!target) return
  const page = await frameUrl(tabId, target.frameId)
  if (!page) return
  const views = await backends.loginsForPage(page)
  for (const view of views) {
    const login = view.logins[0]
    if (login)
      return fillLogin(backends, tabId, target.frameId, view.id, login.id)
  }
}

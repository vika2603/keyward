import { isWebUrl, parseUrl } from "@/lib/site"
import type { ContentMessage } from "./api"
import { CONTENT_MESSAGE } from "./api"

export function webPage(url: string | undefined): URL | null {
  return isWebUrl(url) ? parseUrl(url) : null
}

/** The active tab of the last focused browser window, ignoring popup windows of the extension. */
export async function activeTab(): Promise<Browser.tabs.Tab | undefined> {
  const window = await browser.windows
    .getLastFocused({ windowTypes: ["normal"] })
    .catch(() => null)
  if (window?.id === undefined) return undefined
  const [tab] = await browser.tabs.query({ active: true, windowId: window.id })
  return tab
}

export async function frameUrl(
  tabId: number,
  frameId: number,
): Promise<URL | null> {
  try {
    const frame = await browser.webNavigation.getFrame({ tabId, frameId })
    return webPage(frame?.url)
  } catch {
    return null
  }
}

export function sendToFrame<T = unknown>(
  tabId: number,
  frameId: number,
  message: ContentMessage,
): Promise<T> {
  return browser.tabs.sendMessage(
    tabId,
    { [CONTENT_MESSAGE]: 1, ...message },
    { frameId },
  )
}

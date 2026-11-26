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

/** A frame's current document: its page, and the ID that reaches this document and no later one. */
export interface FrameDocument {
  page: URL
  documentId: string
}

export async function frameDocument(
  tabId: number,
  frameId: number,
): Promise<FrameDocument | null> {
  try {
    const frame = await browser.webNavigation.getFrame({ tabId, frameId })
    const page = webPage(frame?.url)
    return page && frame?.documentId
      ? { page, documentId: frame.documentId }
      : null
  } catch {
    return null
  }
}

/**
 * Sends a message to one document of a tab. Once its frame has navigated to another document, the
 * browser delivers nothing and rejects, as it does when the document has no content script.
 */
export function sendToDocument<T = unknown>(
  tabId: number,
  documentId: string,
  message: ContentMessage,
): Promise<T> {
  return browser.tabs.sendMessage(
    tabId,
    { [CONTENT_MESSAGE]: 1, ...message },
    { documentId },
  )
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

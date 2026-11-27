import { vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { ContentScriptContext } from "wxt/utils/content-script-context"
import {
  type BackgroundApi,
  CONTENT_MESSAGE,
  type ContentConfig,
  type ContentMessage,
} from "@/background/api"
import contentScript from "@/entrypoints/content"

/**
 * happy-dom lays nothing out and computes no default opacity, so every element would count as
 * hidden. This gives each element a box the size of a text field and full opacity, with nothing
 * drawn over it. It also hands closed shadow roots to the extension, as the browser does.
 */
export function stubLayout(): void {
  const closedRoots = new WeakMap<Element, ShadowRoot>()
  const attachShadow = Element.prototype.attachShadow
  vi.spyOn(Element.prototype, "attachShadow").mockImplementation(function (
    this: Element,
    init: ShadowRootInit,
  ) {
    const root = attachShadow.call(this, init)
    if (init.mode === "closed") closedRoots.set(this, root)
    return root
  })
  vi.spyOn(fakeBrowser.dom, "openOrClosedShadowRoot").mockImplementation(
    (element) => element.shadowRoot ?? closedRoots.get(element) ?? null,
  )
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(10, 10, 200, 32),
  )
  const computedStyle = globalThis.getComputedStyle
  vi.spyOn(globalThis, "getComputedStyle").mockImplementation(
    (element, pseudoElement) =>
      new Proxy(computedStyle(element, pseudoElement), {
        get: (style, key) =>
          key === "opacity" ? style.opacity || "1" : Reflect.get(style, key),
      }),
  )
  // The global Document and ShadowRoot are not the classes of happy-dom's nodes.
  const shadowRoot = document
    .createElement("div")
    .attachShadow({ mode: "open" })
  for (const root of [document, Object.getPrototypeOf(shadowRoot)])
    Object.defineProperty(root, "elementsFromPoint", {
      value: () => [],
      configurable: true,
    })
}

/** Marks an event as coming from the user; happy-dom leaves `isTrusted` unset. */
export function trusted<T extends Event>(event: T): T {
  Object.defineProperty(event, "isTrusted", { value: true })
  return event
}

/** Counts the walks over the whole document that finding fields makes. */
export function countDocumentWalks(): () => number {
  const walks = vi.spyOn(document, "createTreeWalker")
  return () => walks.mock.calls.filter(([root]) => root === document).length
}

type Request = {
  [K in keyof BackgroundApi]: { type: K; payload: BackgroundApi[K]["payload"] }
}[keyof BackgroundApi]

const ACTIVE_CONFIG: ContentConfig = {
  active: true,
  scanCodes: false,
  menuTrigger: "focus",
  takeOverPasskeys: false,
  bitwardenPasskeys: false,
  theme: "light",
  language: "en",
}

/**
 * Runs the content script in the current document with a background that turns it on. Returns the
 * requests it made and a way to send it the background's messages.
 */
export async function startContentScript({
  config = {},
  hasCodes = false,
  holdMenuSessions = false,
}: {
  config?: Partial<ContentConfig>
  /** Whether a vault has one-time codes for the page. */
  hasCodes?: boolean
  /** Whether the menu's session requests wait until `answerMenuSession` answers them. */
  holdMenuSessions?: boolean
} = {}) {
  const requests: Request[] = []
  const replies: Partial<Record<keyof BackgroundApi, unknown>> = {
    "content.init": { ...ACTIVE_CONFIG, ...config },
    "content.openMenu": { token: "menu-token" },
    "content.hasCodes": hasCodes,
  }
  const heldMenuSessions: (() => void)[] = []
  fakeBrowser.runtime.onMessage.addListener(
    (message, _sender, sendResponse: (response: unknown) => void) => {
      const request = message as Request & { keyward?: number }
      if (request?.keyward !== 1) return false
      requests.push({ type: request.type, payload: request.payload } as Request)
      const answer = () =>
        sendResponse({ ok: true, value: replies[request.type] ?? null })
      if (holdMenuSessions && request.type === "content.openMenu")
        heldMenuSessions.push(answer)
      else answer()
      return true
    },
  )
  /** Answers a held session request, counted from 0 in the order they were made. */
  const answerMenuSession = async (index: number): Promise<void> => {
    const answer = heldMenuSessions[index]
    if (!answer) throw new Error(`No menu session request ${index}`)
    answer()
    await vi.advanceTimersByTimeAsync(0)
  }
  const ctx = new ContentScriptContext("content")
  await contentScript.main(ctx)
  /** Delivers a message from the background and returns the content script's answer. */
  const send = async (message: ContentMessage): Promise<unknown> => {
    let answer: unknown
    // biome-ignore lint/nursery/noFloatingPromises: trigger already waits for every listener; its type only says a listener may return a promise.
    await fakeBrowser.runtime.onMessage.trigger(
      { [CONTENT_MESSAGE]: 1, ...message },
      {},
      (response: unknown) => {
        answer = response
      },
    )
    return answer
  }
  return { ctx, requests, send, answerMenuSession }
}

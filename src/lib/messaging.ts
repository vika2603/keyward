/**
 * Typed request/response messaging between extension contexts and the background service worker.
 * Each request lists which senders may use it: web pages can talk to content scripts and can
 * embed the two web-accessible pages, so those senders only reach the requests made for them.
 */

export type SenderKind =
  | "popup"
  | "options"
  /** The in-page menu, an extension page inside a web page. */
  | "menu"
  /** The save prompt, an extension page inside a web page. */
  | "savePrompt"
  | "contentScript"

const PAGE_KINDS: Record<string, SenderKind> = {
  "/popup.html": "popup",
  "/options.html": "options",
  "/inline-menu.html": "menu",
  "/save-prompt.html": "savePrompt",
}

interface Envelope {
  keyward: 1
  type: string
  payload: unknown
}

type Reply<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; code: string }

export class RequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
  }
}

/** A map from request type to its payload and result, implemented by the background. */
export type ApiShape = Record<string, { payload: unknown; result: unknown }>

export type Sender = Browser.runtime.MessageSender & { kind: SenderKind }

export type Handlers<Api extends ApiShape> = {
  [K in keyof Api]: {
    allow: readonly SenderKind[]
    handle: (
      payload: Api[K]["payload"],
      sender: Sender,
    ) => Promise<Api[K]["result"]> | Api[K]["result"]
  }
}

export function senderKind(
  sender: Browser.runtime.MessageSender,
): SenderKind | null {
  if (sender.id !== browser.runtime.id || !sender.url) return null
  let url: URL
  try {
    url = new URL(sender.url)
  } catch {
    return null
  }
  if (url.origin === new URL(browser.runtime.getURL("/")).origin)
    return PAGE_KINDS[url.pathname] ?? null
  if (
    sender.tab?.id !== undefined &&
    sender.frameId !== undefined &&
    /^https?:$/.test(url.protocol)
  ) {
    return "contentScript"
  }
  return null
}

export function serveRequests<Api extends ApiShape>(
  handlers: Handlers<Api>,
  errorCode: (error: unknown) => string,
): void {
  browser.runtime.onMessage.addListener(
    (message: unknown, sender, sendResponse) => {
      if (!isEnvelope(message)) return false
      const entry = handlers[message.type as keyof Api]
      // A page built after this background can ask for requests it does not know. Saying so, rather
      // than not answering, lets the page do without the feature.
      if (!entry) {
        sendResponse({
          ok: false,
          error: "Unsupported request",
          code: "unsupported",
        } satisfies Reply<never>)
        return false
      }
      const kind = senderKind(sender)
      if (!kind || !entry.allow.includes(kind)) {
        sendResponse({
          ok: false,
          error: "Not allowed",
          code: "forbidden",
        } satisfies Reply<never>)
        return false
      }
      Promise.resolve()
        .then(() => entry.handle(message.payload as never, { ...sender, kind }))
        .then(
          (value) =>
            sendResponse({
              ok: true,
              value: value ?? null,
            } satisfies Reply<unknown>),
          (error: unknown) =>
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
              code: errorCode(error),
            } satisfies Reply<never>),
        )
      return true
    },
  )
}

export async function sendRequest<
  Api extends ApiShape,
  K extends keyof Api & string,
>(type: K, payload: Api[K]["payload"]): Promise<Api[K]["result"]> {
  const envelope: Envelope = { keyward: 1, type, payload }
  const reply = (await browser.runtime.sendMessage(envelope)) as
    | Reply<Api[K]["result"]>
    | undefined
  if (!reply)
    throw new RequestError("No response from the background", "noResponse")
  if (!reply.ok) throw new RequestError(reply.error, reply.code)
  return reply.value
}

function isEnvelope(message: unknown): message is Envelope {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as Envelope).keyward === 1 &&
    typeof (message as Envelope).type === "string"
  )
}

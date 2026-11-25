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
export type ApiShape = Record<
  string,
  { payload: object | null; result: unknown }
>

export type Sender = Browser.runtime.MessageSender & { kind: SenderKind }

/**
 * A payload as a handler receives it. A sender can put anything in a message, whatever the API
 * says, so every field is unknown until the handler checks it.
 */
export type Untrusted<Payload> = { readonly [Key in keyof Payload]?: unknown }

export type Handlers<Api extends ApiShape> = {
  [K in keyof Api]: {
    allow: readonly SenderKind[]
    handle: (
      payload: Untrusted<Api[K]["payload"]>,
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
      // Own entries only: a type such as "constructor" must not find what every object inherits.
      const entry = Object.hasOwn(handlers, message.type)
        ? handlers[message.type as keyof Api]
        : undefined
      // A page built after this background can ask for requests it does not know. Saying so, rather
      // than not answering, lets the page do without the feature.
      if (!entry) {
        sendResponse(errorReply("Unsupported request", "unsupported"))
        return false
      }
      const kind = senderKind(sender)
      if (!kind || !entry.allow.includes(kind)) {
        sendResponse(errorReply("Not allowed", "forbidden"))
        return false
      }
      Promise.resolve()
        .then(() =>
          entry.handle(fieldsOf(message.payload), { ...sender, kind }),
        )
        .then(
          (value) =>
            sendResponse({
              ok: true,
              value: value ?? null,
            } satisfies Reply<unknown>),
          (error: unknown) =>
            sendResponse(
              errorReply(
                error instanceof Error ? error.message : String(error),
                errorCode(error),
              ),
            ),
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

/** A payload that is not an object reads as one without fields, so handlers can always destructure it. */
function fieldsOf(payload: unknown): Record<string, unknown> {
  return typeof payload === "object" && payload !== null
    ? (payload as Record<string, unknown>)
    : {}
}

function errorReply(error: string, code: string): Reply<never> {
  return { ok: false, error, code }
}

function isEnvelope(message: unknown): message is Envelope {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as Envelope).keyward === 1 &&
    typeof (message as Envelope).type === "string"
  )
}

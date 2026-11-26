import { Cmd } from "./protocol"

/**
 * The host that scripts/setup.sh registers for Keyward. It starts the same helper as
 * Apple's own host, com.apple.passwordmanager, which admits only Apple's extensions.
 */
const HOST_NAME = "keyward.passwords"

export interface HelperMessage {
  cmd: number
  frameId?: number
  [key: string]: unknown
}

/** What the port reports besides the replies its requests wait for. */
export interface HelperPortEvents {
  onUnsolicited: (message: HelperMessage) => void
  onDisconnect: (reason: string | undefined) => void
}

interface Waiter {
  replyCmd: number
  /** The frame ID the request carried for the helper to echo; none on requests sent without one. */
  tag: number | undefined
  newestOnly: boolean
  resolve: (message: HelperMessage) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout> | undefined
}

class HelperDisconnectedError extends Error {}
class HelperTimeoutError extends Error {}

/**
 * Why the browser could not reach the helper: no host manifest names Keyward's host yet, the one
 * there admits other extension IDs, or the helper started and stopped without answering.
 */
export type HelperProblem = "notSetUp" | "otherExtension" | "helperStopped"

/** Tells the problem from Chrome's messages for a native host, which are not translated. */
export function helperProblemOf(failure: unknown): HelperProblem | undefined {
  if (failure instanceof HelperTimeoutError) return "helperStopped"
  const message = failure instanceof Error ? failure.message : String(failure)
  if (message.includes("native messaging host not found")) return "notSetUp"
  if (message.includes("native messaging host is forbidden"))
    return "otherExtension"
  if (/Native host has exited|Failed to start native messaging/.test(message))
    return "helperStopped"
  return undefined
}

/** Whether the problem goes away only with the one-time setup on the Mac. */
export function isSetupProblem(problem: HelperProblem | undefined): boolean {
  return problem === "notSetUp" || problem === "otherExtension"
}

/** Whether the browser starts the helper and gets its hello, or why not. */
export type HelperCheck =
  | { reached: true }
  | { reached: false; problem?: HelperProblem; error: string }

/**
 * Starts the helper on a port of its own and waits for its hello, then lets it go. A session on
 * another port stays as it is, and the answer does not rest on a connection made before the host
 * manifest changed: an open port keeps working after the manifest is removed.
 */
export function checkHelper(timeoutMs: number): Promise<HelperCheck> {
  return new Promise((resolve) => {
    let port: Browser.runtime.Port
    try {
      port = browser.runtime.connectNative(HOST_NAME)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      resolve({
        reached: false,
        problem: helperProblemOf(message),
        error: message,
      })
      return
    }
    const finish = (check: HelperCheck) => {
      clearTimeout(timer)
      port.disconnect()
      resolve(check)
    }
    const timer = setTimeout(
      () =>
        finish({
          reached: false,
          problem: "helperStopped",
          error: "Apple Passwords helper did not answer",
        }),
      timeoutMs,
    )
    port.onMessage.addListener((message: HelperMessage) => {
      if (message.cmd === Cmd.Hello) finish({ reached: true })
    })
    port.onDisconnect.addListener(() => {
      clearTimeout(timer)
      const reason =
        browser.runtime.lastError?.message ??
        "Apple Passwords helper disconnected"
      resolve({
        reached: false,
        problem: helperProblemOf(reason),
        error: reason,
      })
    })
    port.postMessage({ cmd: Cmd.Hello })
  })
}

/** A newer request waiting for the same reply replaced this one. */
export class SupersededError extends Error {}

export interface RequestOptions {
  /** null waits without limit, for replies that follow a system prompt. */
  timeoutMs: number | null
  /** The command number of the reply when it differs from the request's. */
  replyCmd?: number
  /**
   * Gives the request a frame ID of its own, which the helper echoes in the reply, so the reply
   * answers this request alone.
   */
  tagged?: boolean
  /**
   * A new request for the same reply ends this one while it waits, as when the user leaves a
   * Touch ID prompt unanswered and asks again.
   */
  newestOnly?: boolean
}

/**
 * The native messaging connection to Apple's helper. Replies carry no request ID. The helper
 * echoes a request's tab and frame IDs, which Apple's extension uses to send each reply to the
 * frame that asked; this port puts a number of its own in the frame ID instead, so a reply finds
 * its request, and one that comes after its request gave up is dropped. Replies without a frame
 * ID go to the oldest request waiting for that command. An open port also keeps the extension's
 * service worker running.
 */
export class HelperPort {
  private port: Browser.runtime.Port | null = null
  private readonly waiters = new Set<Waiter>()
  private lastTag = 0

  constructor(private readonly listeners: HelperPortEvents) {}

  get connected(): boolean {
    return this.port !== null
  }

  connect(): void {
    if (this.port) return
    const port = browser.runtime.connectNative(HOST_NAME)
    this.port = port
    port.onMessage.addListener((message: HelperMessage) =>
      this.dispatch(message),
    )
    port.onDisconnect.addListener(() => {
      const reason = browser.runtime.lastError?.message
      if (this.port !== port) return
      this.port = null
      this.failAll(
        new HelperDisconnectedError(
          reason ?? "Apple Passwords helper disconnected",
        ),
      )
      this.listeners.onDisconnect(reason)
    })
  }

  disconnect(): void {
    const port = this.port
    if (!port) return
    this.port = null
    try {
      port.postMessage({ cmd: Cmd.End })
    } catch {
      // The port may already be closing.
    }
    port.disconnect()
    this.failAll(new HelperDisconnectedError("Disconnected"))
  }

  post(message: HelperMessage): void {
    if (!this.port)
      throw new HelperDisconnectedError(
        "Apple Passwords helper is not connected",
      )
    this.port.postMessage(message)
  }

  request(
    message: HelperMessage,
    options: RequestOptions,
  ): Promise<HelperMessage> {
    const replyCmd = options.replyCmd ?? message.cmd
    const newestOnly = Boolean(options.newestOnly)
    if (newestOnly) {
      for (const earlier of this.waiters) {
        if (earlier.newestOnly && earlier.replyCmd === replyCmd)
          this.settle(earlier).reject(
            new SupersededError("Replaced by a newer request"),
          )
      }
    }
    const tag = options.tagged ? ++this.lastTag : undefined
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        replyCmd,
        tag,
        newestOnly,
        resolve,
        reject,
        timer: undefined,
      }
      if (options.timeoutMs !== null) {
        waiter.timer = setTimeout(() => {
          this.settle(waiter).reject(
            new HelperTimeoutError(
              `Apple Passwords helper did not answer command ${message.cmd}`,
            ),
          )
        }, options.timeoutMs)
      }
      this.waiters.add(waiter)
      try {
        // Apple's extension sends a tab ID with every frame ID, so this request carries one too.
        this.post(
          tag === undefined ? message : { ...message, tabId: 0, frameId: tag },
        )
      } catch (error) {
        this.settle(waiter).reject(
          error instanceof Error ? error : new Error(String(error)),
        )
      }
    })
  }

  /** Stops a waiter from waiting and hands it back to be resolved or rejected. */
  private settle(waiter: Waiter): Waiter {
    clearTimeout(waiter.timer)
    this.waiters.delete(waiter)
    return waiter
  }

  private dispatch(message: HelperMessage): void {
    const tag =
      typeof message.frameId === "number" ? message.frameId : undefined
    for (const waiter of this.waiters) {
      const answers =
        waiter.replyCmd === message.cmd &&
        (tag === undefined || waiter.tag === undefined || waiter.tag === tag)
      if (answers) {
        this.settle(waiter).resolve(message)
        return
      }
    }
    this.listeners.onUnsolicited(message)
  }

  private failAll(error: Error): void {
    for (const waiter of this.waiters) this.settle(waiter).reject(error)
  }
}

/** A helper message's payload, which the helper sends as JSON text or as an object. */
export function payloadOf(message: HelperMessage): Record<string, unknown> {
  const payload = message.payload
  if (typeof payload === "string") return JSON.parse(payload)
  if (payload && typeof payload === "object")
    return payload as Record<string, unknown>
  throw new Error(`Helper reply to command ${message.cmd} has no payload`)
}

import { Cmd } from "./protocol"

const HOST_NAME = "com.apple.passwordmanager"

export interface HelperMessage {
  cmd: number
  tabId?: number
  frameId?: number
  [key: string]: unknown
}

/** What the port reports besides the replies its requests wait for. */
export interface HelperPortEvents {
  onUnsolicited: (message: HelperMessage) => void
  onDisconnect: (reason: string | undefined) => void
}

interface Waiter {
  resolve: (message: HelperMessage) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout> | undefined
}

class HelperDisconnectedError extends Error {}
class HelperTimeoutError extends Error {}
/** A newer request waiting for the same reply replaced this one. */
export class SupersededError extends Error {}

export interface RequestOptions {
  /** null waits without limit, for replies that follow a system prompt. */
  timeoutMs: number | null
  /** The command number of the reply when it differs from the request's. */
  replyCmd?: number
  /** Match the reply's tabId and frameId, which the helper echoes from the request. */
  matchTab?: boolean
}

function waiterKey(
  cmd: number,
  tab?: { tabId?: number; frameId?: number },
): string {
  return tab ? `${cmd}:${tab.tabId ?? 0}:${tab.frameId ?? 0}` : `${cmd}`
}

/**
 * The native messaging connection to Apple's helper. Replies carry no request ID; they are routed
 * by command number and, where requested, by the tab and frame the helper echoes back. Only one
 * request waits for any given reply; a newer one replaces it. An open port also keeps the
 * extension's service worker running.
 */
export class HelperPort {
  private port: Browser.runtime.Port | null = null
  private readonly waiters = new Map<string, Waiter>()

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
    const key = waiterKey(replyCmd, options.matchTab ? message : undefined)
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, timer: undefined }
      if (options.timeoutMs !== null) {
        waiter.timer = setTimeout(() => {
          if (this.waiters.get(key) === waiter) this.waiters.delete(key)
          reject(
            new HelperTimeoutError(
              `Apple Passwords helper did not answer command ${message.cmd}`,
            ),
          )
        }, options.timeoutMs)
      }
      const previous = this.waiters.get(key)
      if (previous) {
        clearTimeout(previous.timer)
        previous.reject(new SupersededError("Replaced by a newer request"))
      }
      this.waiters.set(key, waiter)
      try {
        this.post(message)
      } catch (error) {
        clearTimeout(waiter.timer)
        if (this.waiters.get(key) === waiter) this.waiters.delete(key)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private dispatch(message: HelperMessage): void {
    const keys = [waiterKey(message.cmd, message), waiterKey(message.cmd)]
    for (const key of keys) {
      const waiter = this.waiters.get(key)
      if (!waiter) continue
      this.waiters.delete(key)
      clearTimeout(waiter.timer)
      waiter.resolve(message)
      return
    }
    this.listeners.onUnsolicited(message)
  }

  private failAll(error: Error): void {
    for (const waiter of this.waiters.values()) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
    this.waiters.clear()
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

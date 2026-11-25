import {
  PASSKEY_CONTROL_EVENT,
  PASSKEY_STATE_EVENT,
} from "@/content/passkey-events"

/** How long a request waits for the content script before the browser gets it after all. */
const UNDECIDED_MS = 2000

interface Held {
  options: CredentialRequestOptions
  resolve: (credential: Credential | null) => void
  reject: (reason: unknown) => void
  /** The browser request made on its behalf, if any. */
  attempt: { controller: AbortController; conditional: boolean } | null
}

/**
 * Runs in the page's own world, before the page's scripts, to take the conditional passkey
 * requests that make the browser list passkeys under a login field. While the content script
 * holds them, the browser shows no list and Keyward's menu offers to sign in with a passkey, which
 * then makes a regular request so the browser shows its passkey dialog. Released requests go to
 * the browser as they came, and so does every other credential request.
 */
export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  allFrames: true,
  runAt: "document_start",
  world: "MAIN",
  main() {
    const container = globalThis.navigator?.credentials
    if (!container?.get) return
    const browserGet = container.get.bind(container)
    /** Null until the content script decides; requests are held meanwhile. */
    let mode: "hold" | "release" | null = null
    let held: Held | null = null

    const report = () =>
      document.dispatchEvent(
        new CustomEvent(PASSKEY_STATE_EVENT, {
          detail: held && !held.attempt ? "waiting" : "none",
        }),
      )

    const finish = (request: Held, settle: () => void) => {
      if (held !== request) return
      held = null
      settle()
      report()
    }

    const attempt = (request: Held, conditional: boolean) => {
      const controller = new AbortController()
      request.attempt = { controller, conditional }
      browserGet({
        ...request.options,
        mediation: conditional ? "conditional" : "optional",
        signal: controller.signal,
      }).then(
        (credential) => {
          if (request.attempt?.controller === controller)
            finish(request, () => request.resolve(credential))
        },
        (error: unknown) => {
          if (request.attempt?.controller !== controller) return
          request.attempt = null
          // Closing the browser's dialog leaves the request waiting, as it would in the list.
          if (
            !conditional &&
            error instanceof DOMException &&
            error.name === "NotAllowedError"
          ) {
            apply()
            return
          }
          finish(request, () => request.reject(error))
        },
      )
    }

    /** Hands the held request to the browser's list or takes it back, as the mode says. */
    const apply = () => {
      const request = held
      if (request && mode === "release" && !request.attempt)
        attempt(request, true)
      else if (request && mode !== "release" && request.attempt?.conditional) {
        const { controller } = request.attempt
        request.attempt = null
        controller.abort()
      }
      report()
    }

    container.get = function get(
      options?: CredentialRequestOptions,
    ): Promise<Credential | null> {
      if (options?.mediation !== "conditional" || !options.publicKey)
        return browserGet(options)
      const signal = options.signal
      if (signal?.aborted) return Promise.reject(signal.reason)
      if (held)
        return Promise.reject(
          new DOMException("A request is already pending.", "NotAllowedError"),
        )
      return new Promise((resolve, reject) => {
        const request: Held = { options, resolve, reject, attempt: null }
        held = request
        signal?.addEventListener(
          "abort",
          () => {
            const controller = request.attempt?.controller
            request.attempt = null
            controller?.abort()
            finish(request, () => reject(signal.reason))
          },
          { once: true },
        )
        if (mode === null)
          setTimeout(() => {
            if (mode !== null) return
            mode = "release"
            apply()
          }, UNDECIDED_MS)
        apply()
      })
    }

    document.addEventListener(PASSKEY_CONTROL_EVENT, (event) => {
      const control = (event as CustomEvent<unknown>).detail
      if (control === "hold" || control === "release") {
        mode = control
        apply()
      } else if (control === "use") {
        if (held && !held.attempt) attempt(held, false)
        report()
      }
    })
  },
})

import {
  PASSKEY_BRIDGE_REQUEST_EVENT,
  PASSKEY_BRIDGE_RESPONSE_EVENT,
  PASSKEY_CONTROL_EVENT,
  PASSKEY_STATE_EVENT,
  type PasskeyBridgeRequestDetail,
  type PasskeyBridgeResponseDetail,
  type PasskeyControlDetail,
  type PasskeyStateDetail,
} from "@/content/passkey-events"
import {
  buildAssertionCredential,
  buildAttestationCredential,
  isWebAuthnFeatureAllowed,
  serializeCreateRequest,
  serializeGetRequest,
} from "@/content/passkey-wire"
import type {
  PasskeyBridgeOutcome,
  PasskeyGetRequest,
} from "@/lib/passkeys/types"

/** How long a conditional request waits for content script config before falling back to browser. */
const UNDECIDED_CONDITIONAL_MS = 2000
/** How long a modal request waits for initial content script config before native passthrough. */
const UNDECIDED_MODAL_MS = 800

interface HeldConditional {
  options: CredentialRequestOptions
  serialized: PasskeyGetRequest
  resolve: (credential: Credential | null) => void
  reject: (reason: unknown) => void
  attempt: { controller: AbortController; conditional: boolean } | null
}

/**
 * Runs in the page's MAIN world at `document_start` to bridge WebAuthn `create` and `get`
 * (conditional and modal) between the page and Keyward's Bitwarden passkey authenticator,
 * while passing pure Apple Passwords users and explicit fallbacks straight through to native WebAuthn.
 */
export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  allFrames: true,
  runAt: "document_start",
  world: "MAIN",
  main() {
    const credentials = globalThis.navigator?.credentials
    if (!credentials?.get || !credentials?.create) return
    const browserGet = credentials.get.bind(credentials)
    const browserCreate = credentials.create.bind(credentials)

    /** Null until the content script sends its initial config. */
    let holdConditional: boolean | null = null
    let interceptModal: boolean | null = null
    const configWaiters: (() => void)[] = []

    let held: HeldConditional | null = null
    const bridgePending = new Map<
      string,
      (outcome: PasskeyBridgeOutcome) => void
    >()

    const reportState = () => {
      const detail: PasskeyStateDetail =
        held && !held.attempt
          ? { state: "waiting", request: held.serialized }
          : { state: "none" }
      document.dispatchEvent(new CustomEvent(PASSKEY_STATE_EVENT, { detail }))
    }

    const finishConditional = (
      request: HeldConditional,
      settle: () => void,
    ) => {
      if (held !== request) return
      held = null
      settle()
      reportState()
    }

    const attemptConditionalNative = (
      request: HeldConditional,
      conditional: boolean,
    ) => {
      const controller = new AbortController()
      request.attempt = { controller, conditional }
      browserGet({
        ...request.options,
        mediation: conditional ? "conditional" : "optional",
        signal: controller.signal,
      }).then(
        (credential) => {
          if (request.attempt?.controller !== controller) return
          finishConditional(request, () => request.resolve(credential))
        },
        (error: unknown) => {
          if (request.attempt?.controller !== controller) return
          request.attempt = null
          // Closing the native dialog leaves the conditional request waiting for the menu again.
          const userDismissedModal =
            !conditional &&
            error instanceof DOMException &&
            error.name === "NotAllowedError"
          if (userDismissedModal) {
            applyConditionalMode()
            return
          }
          finishConditional(request, () => request.reject(error))
        },
      )
    }

    const applyConditionalMode = () => {
      const request = held
      if (request && holdConditional === false && !request.attempt) {
        attemptConditionalNative(request, true)
      } else if (
        request &&
        holdConditional !== false &&
        request.attempt?.conditional
      ) {
        const { controller } = request.attempt
        request.attempt = null
        controller.abort()
      }
      reportState()
    }

    const waitForModalConfig = (): Promise<boolean> => {
      if (interceptModal !== null) return Promise.resolve(interceptModal)
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          resolve(interceptModal === true)
        }, UNDECIDED_MODAL_MS)
        configWaiters.push(() => {
          clearTimeout(timer)
          resolve(interceptModal === true)
        })
      })
    }

    const sendBridge = (
      detail: PasskeyBridgeRequestDetail,
      signal?: AbortSignal,
    ): Promise<PasskeyBridgeOutcome> => {
      if (detail.kind === "cancel") {
        document.dispatchEvent(
          new CustomEvent(PASSKEY_BRIDGE_REQUEST_EVENT, { detail }),
        )
        return Promise.resolve({ kind: "cancel" })
      }
      if (signal?.aborted) {
        return Promise.reject(
          signal.reason ??
            new DOMException("The operation was aborted.", "AbortError"),
        )
      }
      return new Promise((resolve, reject) => {
        const onAbort = () => {
          if (!bridgePending.delete(detail.requestId)) return
          document.dispatchEvent(
            new CustomEvent(PASSKEY_BRIDGE_REQUEST_EVENT, {
              detail: {
                requestId: detail.requestId,
                kind: "cancel",
              } satisfies PasskeyBridgeRequestDetail,
            }),
          )
          reject(
            signal?.reason ??
              new DOMException("The operation was aborted.", "AbortError"),
          )
        }
        bridgePending.set(detail.requestId, (outcome) => {
          signal?.removeEventListener("abort", onAbort)
          resolve(outcome)
        })
        signal?.addEventListener("abort", onAbort, { once: true })
        document.dispatchEvent(
          new CustomEvent(PASSKEY_BRIDGE_REQUEST_EVENT, { detail }),
        )
      })
    }

    const handleModalBridge = async (
      detail: PasskeyBridgeRequestDetail,
      signal: AbortSignal | undefined,
      fallback: () => Promise<Credential | null>,
    ): Promise<Credential | null> => {
      if (!(await waitForModalConfig())) return fallback()
      const outcome = await sendBridge(detail, signal)
      if (outcome.kind === "asserted")
        return buildAssertionCredential(outcome.credential)
      if (outcome.kind === "created")
        return buildAttestationCredential(outcome.credential)
      if (outcome.kind === "fallback") return fallback()
      if (outcome.kind === "error")
        throw new DOMException(outcome.message, outcome.name)
      throw new DOMException(
        "The operation either timed out or was not allowed.",
        "NotAllowedError",
      )
    }

    credentials.get = function get(
      options?: CredentialRequestOptions,
    ): Promise<Credential | null> {
      if (!options?.publicKey) return browserGet(options)
      const canIntercept =
        window.isSecureContext &&
        isWebAuthnFeatureAllowed("publickey-credentials-get")
      if (!canIntercept) return browserGet(options)

      // Conditional UI request: held for Keyward's inline menu (Bitwarden + native fallback).
      if (options.mediation === "conditional") {
        const signal = options.signal
        if (signal?.aborted) return Promise.reject(signal.reason)
        if (held) {
          return Promise.reject(
            new DOMException(
              "A request is already pending.",
              "NotAllowedError",
            ),
          )
        }
        const serialized = serializeGetRequest(options.publicKey)
        return new Promise((resolve, reject) => {
          const request: HeldConditional = {
            options,
            serialized,
            resolve,
            reject,
            attempt: null,
          }
          held = request
          signal?.addEventListener(
            "abort",
            () => {
              const controller = request.attempt?.controller
              request.attempt = null
              controller?.abort()
              finishConditional(request, () => reject(signal.reason))
            },
            { once: true },
          )
          if (holdConditional === null) {
            setTimeout(() => {
              if (holdConditional !== null) return
              holdConditional = false
              applyConditionalMode()
            }, UNDECIDED_CONDITIONAL_MS)
          }
          applyConditionalMode()
        })
      }

      const publicKey = options.publicKey
      return handleModalBridge(
        {
          requestId: crypto.randomUUID(),
          kind: "get",
          request: serializeGetRequest(publicKey),
        },
        options.signal,
        () => browserGet(options),
      )
    }

    credentials.create = function create(
      options?: CredentialCreationOptions,
    ): Promise<Credential | null> {
      if (!options?.publicKey) return browserCreate(options)
      const canIntercept =
        window.isSecureContext &&
        isWebAuthnFeatureAllowed("publickey-credentials-create")
      if (!canIntercept) return browserCreate(options)

      const publicKey = options.publicKey
      return handleModalBridge(
        {
          requestId: crypto.randomUUID(),
          kind: "create",
          request: serializeCreateRequest(publicKey),
        },
        options.signal,
        () => browserCreate(options),
      )
    }

    document.addEventListener(PASSKEY_CONTROL_EVENT, (event) => {
      const control = (event as CustomEvent<unknown>)
        .detail as PasskeyControlDetail | null
      if (!control || typeof control !== "object") return
      if (control.type === "config") {
        holdConditional = control.holdConditional
        interceptModal = control.interceptModal
        while (configWaiters.length) configWaiters.shift()?.()
        applyConditionalMode()
      } else if (control.type === "useNative") {
        if (held && !held.attempt) attemptConditionalNative(held, false)
        reportState()
      } else if (control.type === "resolveConditional") {
        if (!held) return
        const target = held
        const controller = target.attempt?.controller
        target.attempt = null
        controller?.abort()
        finishConditional(target, () =>
          target.resolve(buildAssertionCredential(control.credential)),
        )
      }
    })

    document.addEventListener(PASSKEY_BRIDGE_RESPONSE_EVENT, (event) => {
      const detail = (event as CustomEvent<unknown>)
        .detail as PasskeyBridgeResponseDetail | null
      if (!detail || typeof detail.requestId !== "string") return
      const settle = bridgePending.get(detail.requestId)
      if (!settle) return
      bridgePending.delete(detail.requestId)
      settle(detail.outcome)
    })
  },
})

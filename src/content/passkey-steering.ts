import type { ContentScriptContext } from "wxt/utils/content-script-context"
import { callBackground } from "@/background/api"
import type {
  PasskeyBridgeOutcome,
  PasskeyGetRequest,
  SerializedGetResult,
} from "@/lib/passkeys/types"
import {
  PASSKEY_BRIDGE_REQUEST_EVENT,
  PASSKEY_BRIDGE_RESPONSE_EVENT,
  PASSKEY_CONTROL_EVENT,
  PASSKEY_STATE_EVENT,
  type PasskeyBridgeRequestDetail,
  type PasskeyBridgeResponseDetail,
  type PasskeyControlDetail,
  type PasskeyStateDetail,
} from "./passkey-events"

/**
 * Isolated-world bridge to `passkeys.content.ts`:
 * - Tracks held conditional WebAuthn `get` requests for the inline menu.
 * - Forwards modal WebAuthn `create`/`get` requests to the background service worker.
 */
export class PasskeySteering {
  private requestWaiting = false
  private currentRequest: PasskeyGetRequest | null = null
  private lastConfig: {
    holdConditional: boolean
    interceptModal: boolean
  } | null = null

  constructor(
    ctx: ContentScriptContext,
    options: {
      /** The page-world script started or stopped holding a conditional request. */
      onWaitingChange: () => void
    },
  ) {
    ctx.addEventListener(document, PASSKEY_STATE_EVENT, (event) => {
      const detail = (event as CustomEvent<unknown>)
        .detail as PasskeyStateDetail | null
      const waiting = detail?.state === "waiting"
      this.currentRequest = waiting ? detail.request : null
      if (waiting === this.requestWaiting) return
      this.requestWaiting = waiting
      options.onWaitingChange()
    })

    ctx.addEventListener(document, PASSKEY_BRIDGE_REQUEST_EVENT, (event) => {
      const detail = (event as CustomEvent<unknown>)
        .detail as PasskeyBridgeRequestDetail | null
      if (!detail || typeof detail.requestId !== "string") return
      if (detail.kind === "cancel") {
        void callBackground("content.passkeyCancel", {
          requestId: detail.requestId,
        }).catch(() => {})
        return
      }
      const pending =
        detail.kind === "get"
          ? callBackground("content.passkeyGet", {
              requestId: detail.requestId,
              request: detail.request,
            })
          : callBackground("content.passkeyCreate", {
              requestId: detail.requestId,
              request: detail.request,
            })
      void pending
        .then(
          (outcome): PasskeyBridgeOutcome => outcome,
          (): PasskeyBridgeOutcome => ({ kind: "fallback" }),
        )
        .then((outcome) => {
          document.dispatchEvent(
            new CustomEvent<PasskeyBridgeResponseDetail>(
              PASSKEY_BRIDGE_RESPONSE_EVENT,
              { detail: { requestId: detail.requestId, outcome } },
            ),
          )
        })
    })

    // When this content script instance is invalidated, release control back to the browser.
    ctx.onInvalidated(() =>
      this.sendControl({
        type: "config",
        holdConditional: false,
        interceptModal: false,
      }),
    )
  }

  /** Whether the page-world script holds a conditional passkey request for the menu. */
  get waiting(): boolean {
    return this.requestWaiting
  }

  /** Serialized parameters of the held conditional request, if any. */
  get waitingRequest(): PasskeyGetRequest | null {
    return this.currentRequest
  }

  /** Configures conditional menu steering and modal Bitwarden passkey interception. */
  configure(next: { holdConditional: boolean; interceptModal: boolean }): void {
    if (
      this.lastConfig &&
      this.lastConfig.holdConditional === next.holdConditional &&
      this.lastConfig.interceptModal === next.interceptModal
    )
      return
    this.lastConfig = next
    this.sendControl({ type: "config", ...next })
  }

  /** Hands the held conditional request to the browser's native passkey dialog (Apple Passwords / hardware key). */
  use(): void {
    this.sendControl({ type: "useNative" })
  }

  /** Resolves the held conditional request directly with a Bitwarden-signed passkey assertion. */
  resolveConditional(credential: SerializedGetResult): void {
    this.sendControl({ type: "resolveConditional", credential })
  }

  private sendControl(detail: PasskeyControlDetail): void {
    document.dispatchEvent(new CustomEvent(PASSKEY_CONTROL_EVENT, { detail }))
  }
}

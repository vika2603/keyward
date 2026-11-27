import type {
  PasskeyBridgeOutcome,
  PasskeyCreateRequest,
  PasskeyGetRequest,
  SerializedGetResult,
} from "@/lib/passkeys/types"

/**
 * Events between the isolated content script and the MAIN-world passkey bridge.
 *
 * Security note: All verification of origin/RP ID and all cryptographic key operations happen
 * strictly inside the background service worker. Nothing secret crosses the DOM event channel —
 * only public WebAuthn request parameters and public signed assertion/attestation responses that
 * the WebAuthn API itself hands to the page.
 */

/** Sent by MAIN world whenever the held conditional get request starts or stops waiting. */
export const PASSKEY_STATE_EVENT = "keyward:passkey-state"

/** Sent by isolated content script to configure MAIN world or settle a held conditional request. */
export const PASSKEY_CONTROL_EVENT = "keyward:passkey-control"

/** Sent by MAIN world to isolated content script for modal create/get/cancel requests. */
export const PASSKEY_BRIDGE_REQUEST_EVENT = "keyward:passkey-bridge-request"

/** Sent by isolated content script back to MAIN world with the background's decision/result. */
export const PASSKEY_BRIDGE_RESPONSE_EVENT = "keyward:passkey-bridge-response"

export type PasskeyStateDetail =
  | { state: "waiting"; request: PasskeyGetRequest }
  | { state: "none" }

export type PasskeyControlDetail =
  | {
      type: "config"
      holdConditional: boolean
      interceptModal: boolean
    }
  | { type: "useNative" }
  | { type: "resolveConditional"; credential: SerializedGetResult }

export type PasskeyBridgeRequestDetail =
  | { requestId: string; kind: "get"; request: PasskeyGetRequest }
  | { requestId: string; kind: "create"; request: PasskeyCreateRequest }
  | { requestId: string; kind: "cancel" }

export interface PasskeyBridgeResponseDetail {
  requestId: string
  outcome: PasskeyBridgeOutcome
}

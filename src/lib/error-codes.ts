/**
 * The code a failed request reports. The pages turn each into a message, so every code has one in
 * `components/keyward/errors.ts` or is listed there as needing none. A provider's own codes start
 * with its kind.
 */
export type ErrorCode =
  | "forbidden"
  | "unsupported"
  | "noResponse"
  | "internal"
  | "network"
  | "invalidInput"
  | "invalidSite"
  | "locked"
  | "notFound"
  | "unknownLogin"
  | "unknownVault"
  | "notEditable"
  | "noCode"
  | "noPassword"
  | "invalidCodeKey"
  | "noSetup"
  | "notWebPage"
  | "fillDisabled"
  | "insecureHttp"
  | "pageChanged"
  | "cancelled"
  | "overlay.closed"
  | `apple.${
      | "unavailable"
      | "disabled"
      | "wrongCode"
      | "refused"
      | "protocol"
      | "unsupported"
      | "noPairing"
      | "notSaved"
      | "saveUnconfirmed"
      | "emptyUsername"
      | "emptyPassword"
      | "unsupportedSite"
      | "query"}`
  | `bitwarden.${
      | "wrongPassword"
      | "auth"
      | "api"
      | "signedOut"
      | "noPendingSignIn"
      | "method"
      | "reprompt"
      | "noData"}`

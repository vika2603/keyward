import { type MessageKey, t } from "@/lib/i18n"
import { RequestError } from "@/lib/messaging"

const MESSAGES: Record<string, MessageKey> = {
  forbidden: "error.forbidden",
  locked: "error.locked",
  network: "error.network",
  invalidInput: "error.invalidInput",
  invalidSite: "error.invalidSite",
  notFound: "error.notFound",
  unknownLogin: "error.notFound",
  unknownVault: "error.unknownVault",
  notWebPage: "error.notWebPage",
  fillDisabled: "error.fillDisabled",
  pageChanged: "error.pageChanged",
  noResponse: "error.unsupported",
  unsupported: "error.unsupported",
  noCode: "error.noCode",
  noPassword: "error.noPassword",
  invalidCodeKey: "error.invalidCodeKey",
  noSetup: "error.noSetup",
  notEditable: "error.notEditable",
  "apple.unavailable": "error.apple.unavailable",
  "apple.disabled": "error.apple.disabled",
  "apple.wrongCode": "error.apple.wrongCode",
  "apple.refused": "error.apple.refused",
  "apple.protocol": "error.apple.protocol",
  "apple.unsupported": "error.apple.unsupported",
  "apple.noPairing": "error.apple.noPairing",
  "apple.notSaved": "error.apple.notSaved",
  "apple.saveUnconfirmed": "error.apple.saveUnconfirmed",
  "apple.emptyUsername": "error.apple.emptyUsername",
  "apple.emptyPassword": "error.apple.emptyPassword",
  "apple.unsupportedSite": "error.apple.unsupportedSite",
  "apple.query": "error.apple.query",
  "bitwarden.wrongPassword": "error.bitwarden.wrongPassword",
  "bitwarden.auth": "error.bitwarden.auth",
  "bitwarden.signedOut": "error.bitwarden.signedOut",
  "bitwarden.noPendingSignIn": "error.bitwarden.noPendingSignIn",
  "bitwarden.method": "error.bitwarden.method",
  "bitwarden.reprompt": "error.bitwarden.reprompt",
  "bitwarden.noData": "error.bitwarden.noData",
}

/** Codes that mean the user replaced or closed the action; they need no message. */
const SILENT = new Set(["cancelled", "overlay.closed"])

/** A message for the user, or null when the error needs none. */
export function errorMessage(error: unknown): string | null {
  if (error instanceof RequestError) {
    if (SILENT.has(error.code)) return null
    const known = MESSAGES[error.code]
    if (known) return t(known)
    if (error.code === "bitwarden.api")
      return t("error.bitwarden.api", { message: error.message })
  }
  const text = error instanceof Error ? error.message : String(error)
  return t("error.other", { message: text })
}

export function errorCodeOf(error: unknown): string | null {
  return error instanceof RequestError ? error.code : null
}

/**
 * Whether the background lacks the request, as one still running code from before an update does.
 * Backgrounds built before `unsupported` existed leave such requests unanswered.
 */
export function isUnsupportedRequest(error: unknown): boolean {
  const code = errorCodeOf(error)
  return code === "unsupported" || code === "noResponse"
}

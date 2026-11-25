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
  unknownSource: "error.unknownSource",
  notWebPage: "error.notWebPage",
  fillDisabled: "error.fillDisabled",
  pageChanged: "error.pageChanged",
  noResponse: "error.noResponse",
  noCode: "error.noCode",
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
  "apple.emptyUsername": "error.apple.emptyUsername",
  "apple.unsupportedSite": "error.apple.unsupportedSite",
  "apple.query": "error.apple.query",
  "apple.noPassword": "error.apple.noPassword",
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

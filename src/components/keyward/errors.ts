import type { ErrorCode } from "@/lib/error-codes"
import { type MessageKey, t } from "@/lib/i18n"
import { RequestError } from "@/lib/messaging"

/** Codes that mean the user replaced or closed the action; they need no message. */
type SilentCode = "cancelled" | "overlay.closed"

const SILENT_CODES: ReadonlySet<string> = new Set<SilentCode>([
  "cancelled",
  "overlay.closed",
])

/**
 * Codes whose message is the error's own text: an unexpected failure, and a server error, which
 * the message quotes.
 */
type OwnTextCode = "internal" | "bitwarden.api"

type MessagedCode = Exclude<ErrorCode, SilentCode | OwnTextCode>

const MESSAGES: Record<MessagedCode, MessageKey> = {
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
  insecureHttp: "error.insecureHttp",
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

function isMessagedCode(code: string): code is MessagedCode {
  return Object.hasOwn(MESSAGES, code)
}

/** A message for the user, or null when the error needs none. */
export function errorMessage(error: unknown): string | null {
  if (error instanceof RequestError) {
    if (SILENT_CODES.has(error.code)) return null
    if (isMessagedCode(error.code)) return t(MESSAGES[error.code])
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

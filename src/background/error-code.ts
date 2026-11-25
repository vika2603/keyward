import { ApiError, NetworkError } from "@/lib/providers/bitwarden/api"
import { WrongPasswordError } from "@/lib/providers/bitwarden/crypto"
import { VaultError } from "@/lib/providers/types"

/** The code a failed request reports, which the pages turn into a message. */
export function errorCode(error: unknown): string {
  if (error instanceof VaultError) return error.code
  if (error instanceof WrongPasswordError) return "bitwarden.wrongPassword"
  if (error instanceof ApiError)
    return error.isAuthError ? "bitwarden.auth" : "bitwarden.api"
  if (error instanceof NetworkError) return "network"
  return "internal"
}

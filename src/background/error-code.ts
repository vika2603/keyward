import type { ErrorCode } from "@/lib/error-codes"
import { VaultError } from "@/lib/providers/types"

/** The code a failed request reports, which the pages turn into a message. */
export function errorCode(error: unknown): ErrorCode {
  return error instanceof VaultError ? error.code : "internal"
}

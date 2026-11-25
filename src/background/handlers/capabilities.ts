import { VaultError } from "@/lib/providers/types"

export function notEditable(): VaultError {
  return new VaultError("The login cannot be changed", "notEditable")
}

export function noNotes(): VaultError {
  return new VaultError("The vault keeps no notes", "notFound")
}

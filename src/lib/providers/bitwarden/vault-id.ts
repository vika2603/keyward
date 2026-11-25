import { VaultError } from "../types"

const VAULT_PREFIX = "bitwarden:"

export function vaultIdOf(accountId: string): string {
  return VAULT_PREFIX + accountId
}

export function isBitwardenVault(vaultId: string): boolean {
  return vaultId.startsWith(VAULT_PREFIX)
}

export function accountIdOfVault(vaultId: string): string {
  if (!isBitwardenVault(vaultId))
    throw new VaultError("Unknown vault", "unknownVault")
  return vaultId.slice(VAULT_PREFIX.length)
}

import type { PasskeyDescriptor, PasskeyOption } from "@/lib/passkeys/types"
import { credentialIdBase64Url } from "@/lib/passkeys/webauthn"
import type { VaultInfo } from "../types"
import { ciphersById } from "./audit"
import { decryptFido2Credentials } from "./decrypt"
import type { Vault } from "./vault-cache"

/** Collects matching non-reprompt passkeys for `rpId` from one unlocked Bitwarden vault. */
export function collectVaultPasskeys(
  vaultInfo: VaultInfo,
  vault: Vault,
  rpId: string,
  allowSet: ReadonlySet<string> | null,
): PasskeyOption[] {
  const normalizedRp = rpId.trim().toLowerCase()
  const cipherById = ciphersById(vault.ciphers)
  const options: PasskeyOption[] = []

  for (const item of vault.items) {
    if (item.reprompt) continue
    const cipher = cipherById.get(item.id)
    if (!cipher) continue
    for (const cred of decryptFido2Credentials(cipher, vault.keys)) {
      if (cred.rpId.trim().toLowerCase() !== normalizedRp) continue
      if (allowSet && !allowSet.has(credentialIdBase64Url(cred.credentialId)))
        continue
      options.push({
        vaultId: vaultInfo.id,
        vaultName: vaultInfo.label,
        loginId: item.id,
        itemName: item.name,
        credentialId: cred.credentialId,
        rpId: cred.rpId,
        userName: cred.userName || item.username,
        userDisplayName: cred.userDisplayName || cred.userName || item.name,
        creationDate: cred.creationDate,
      })
    }
  }
  return options
}

/** Returns true if any cipher in `vault` already stores a credential listed in `excludeCredentials`. */
export function hasExcludedPasskey(
  vault: Vault,
  rpId: string,
  excludeCredentials: readonly PasskeyDescriptor[],
): boolean {
  if (!excludeCredentials.length) return false
  const normalizedRp = rpId.trim().toLowerCase()
  const excluded = new Set(excludeCredentials.map((cred) => cred.id))
  for (const cipher of vault.ciphers) {
    for (const cred of decryptFido2Credentials(cipher, vault.keys)) {
      if (
        cred.rpId.trim().toLowerCase() === normalizedRp &&
        excluded.has(credentialIdBase64Url(cred.credentialId))
      ) {
        return true
      }
    }
  }
  return false
}

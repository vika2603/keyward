import { createRequire } from "node:module"
import type { PureCrypto } from "@bitwarden/sdk-internal"
import {
  accountIdOf,
  saveAccount,
  saveSession,
  saveSync,
} from "./account-store"
import { KdfType, pureCryptoAdapter } from "./crypto"
import { vaultIdOf } from "./vault-id"

/** The SDK's Node build, for tests; it runs the same WebAssembly as the extension. */
export const sdk = createRequire(import.meta.url)(
  "@bitwarden/sdk-internal/node/bitwarden_wasm_internal.js",
).PureCrypto as typeof PureCrypto

export const testVaultCrypto = pureCryptoAdapter(sdk)

/** Seeds an unlocked Bitwarden test account, active session, and optional encrypted sync payload. */
export async function seedUnlockedAccount(options: {
  server?: string
  userId: string
  email?: string
  name?: string
  userKey: Uint8Array
  syncData?: Record<string, unknown>
}): Promise<{ accountId: string; vaultId: string }> {
  const server = options.server ?? "https://vault.example.test"
  const accountId = accountIdOf(server, options.userId)
  await saveAccount({
    id: accountId,
    userId: options.userId,
    email: options.email ?? `${options.userId}@example.test`,
    ...(options.name ? { name: options.name } : {}),
    server,
    kdf: { type: KdfType.Pbkdf2Sha256, iterations: 5000 },
    salt: "",
    wrappedUserKey: "unused",
    encryptedRefreshToken: "unused",
  })
  await saveSession(accountId, {
    userKey: options.userKey.toBase64(),
    accessToken: "token",
    accessTokenExpiresAt: Date.now() + 60 * 60_000,
    refreshToken: "refresh",
  })
  if (options.syncData !== undefined) {
    await saveSync(accountId, {
      syncedAt: Date.now(),
      data: options.syncData,
    })
  }
  return { accountId, vaultId: vaultIdOf(accountId) }
}

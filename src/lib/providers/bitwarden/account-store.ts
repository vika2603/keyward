import type { KdfConfig } from "./crypto"
import type { CustomEndpoints } from "./server"

/**
 * A signed-in account. Persisted in storage.local, which is not encrypted, so it holds nothing
 * usable without the master password: the user key and the refresh token are stored encrypted.
 */
export interface StoredAccount {
  id: string
  userId: string
  email: string
  /** Server address as entered; empty for bitwarden.com. */
  server: string
  /** Endpoints of a self-hosted server that do not follow from its address. */
  endpoints?: CustomEndpoints
  /** A name the user gave the account; empty or missing to show the email address. */
  name?: string
  kdf: KdfConfig
  salt: string
  wrappedUserKey: string
  /** The refresh token encrypted with the user key. */
  encryptedRefreshToken: string
}

/** The unlocked state of an account, kept in storage.session so it ends with the browser. */
export interface AccountSession {
  userKey: string
  accessToken: string
  accessTokenExpiresAt: number
  refreshToken: string
}

/**
 * The content script imports this module for this key, so the module defines no `wxt/storage`
 * items: defining one reads storage at once, in every frame the script runs in.
 */
export const ACCOUNTS_KEY = "bitwarden.accounts"
const DEVICE_KEY = "bitwarden.deviceId"
const sessionKey = (accountId: string) => `bitwarden.session.${accountId}`
const syncKey = (accountId: string) => `bitwarden.sync.${accountId}`

export function accountIdOf(server: string, userId: string): string {
  return `${server || "official"}|${userId}`
}

export async function loadAccounts(): Promise<StoredAccount[]> {
  const stored = (await browser.storage.local.get(ACCOUNTS_KEY))[ACCOUNTS_KEY]
  return Array.isArray(stored) ? (stored as StoredAccount[]) : []
}

export async function saveAccount(account: StoredAccount): Promise<void> {
  const accounts = (await loadAccounts()).filter((a) => a.id !== account.id)
  await browser.storage.local.set({ [ACCOUNTS_KEY]: [...accounts, account] })
}

export async function setAccountName(
  accountId: string,
  name: string,
): Promise<void> {
  const accounts = (await loadAccounts()).map((account) =>
    account.id === accountId ? { ...account, name } : account,
  )
  await browser.storage.local.set({ [ACCOUNTS_KEY]: accounts })
}

export async function removeAccount(accountId: string): Promise<void> {
  const accounts = (await loadAccounts()).filter((a) => a.id !== accountId)
  await browser.storage.local.set({ [ACCOUNTS_KEY]: accounts })
  await browser.storage.session.remove([
    sessionKey(accountId),
    syncKey(accountId),
  ])
}

export async function loadSession(
  accountId: string,
): Promise<AccountSession | null> {
  const key = sessionKey(accountId)
  return (
    ((await browser.storage.session.get(key))[key] as
      | AccountSession
      | undefined) ?? null
  )
}

export async function saveSession(
  accountId: string,
  session: AccountSession,
): Promise<void> {
  await browser.storage.session.set({ [sessionKey(accountId)]: session })
}

export async function clearSession(accountId: string): Promise<void> {
  await browser.storage.session.remove([
    sessionKey(accountId),
    syncKey(accountId),
  ])
}

export interface StoredSync {
  syncedAt: number
  data: Record<string, unknown>
}

/** The last sync response. It is encrypted except for metadata, and kept only for the session. */
export async function loadSync(accountId: string): Promise<StoredSync | null> {
  const key = syncKey(accountId)
  return (
    ((await browser.storage.session.get(key))[key] as StoredSync | undefined) ??
    null
  )
}

export async function saveSync(
  accountId: string,
  sync: StoredSync,
): Promise<void> {
  await browser.storage.session.set({ [syncKey(accountId)]: sync })
}

/** A random device ID, created once; the server lists signed-in devices by it. */
export async function deviceIdentifier(): Promise<string> {
  const stored = (await browser.storage.local.get(DEVICE_KEY))[DEVICE_KEY]
  if (typeof stored === "string") return stored
  const id = crypto.randomUUID()
  await browser.storage.local.set({ [DEVICE_KEY]: id })
  return id
}

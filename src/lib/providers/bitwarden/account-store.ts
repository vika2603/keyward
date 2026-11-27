import { serialQueue } from "@/lib/serial-queue"
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
/** When the account last synced, apart from the synced data, so it can be read without the data. */
const syncedAtKey = (accountId: string) => `bitwarden.syncedAt.${accountId}`
const activityKey = (accountId: string) => `bitwarden.activity.${accountId}`

/** All accounts are one stored list; its changes run one at a time so none is lost. */
const accountsChange = serialQueue()

function changeAccounts(
  change: (accounts: StoredAccount[]) => StoredAccount[],
): Promise<void> {
  return accountsChange(async () => {
    const accounts = change(await loadAccounts())
    await browser.storage.local.set({ [ACCOUNTS_KEY]: accounts })
  })
}

export function accountIdOf(server: string, userId: string): string {
  return `${server || "official"}|${userId}`
}

export async function loadAccounts(): Promise<StoredAccount[]> {
  const stored = (await browser.storage.local.get(ACCOUNTS_KEY))[ACCOUNTS_KEY]
  return Array.isArray(stored) ? (stored as StoredAccount[]) : []
}

export function saveAccount(account: StoredAccount): Promise<void> {
  return changeAccounts((accounts) => [
    ...accounts.filter((stored) => stored.id !== account.id),
    account,
  ])
}

/** Changes a stored account in place; nothing happens when it was signed out meanwhile. */
export function updateAccount(
  accountId: string,
  change: (account: StoredAccount) => StoredAccount,
): Promise<void> {
  return changeAccounts((accounts) =>
    accounts.map((account) =>
      account.id === accountId ? change(account) : account,
    ),
  )
}

export async function removeAccount(accountId: string): Promise<void> {
  await changeAccounts((accounts) =>
    accounts.filter((account) => account.id !== accountId),
  )
  await Promise.all([
    browser.storage.session.remove([
      sessionKey(accountId),
      activityKey(accountId),
    ]),
    browser.storage.local.remove([syncKey(accountId), syncedAtKey(accountId)]),
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
  // Keeps the encrypted sync in storage.local so unlocking offline still works; only the session key is cleared.
  await browser.storage.session.remove([sessionKey(accountId)])
}

export interface StoredSync {
  syncedAt: number
  /** Server's last /accounts/revision-date timestamp when known. */
  revisionDate?: number | null
  data: Record<string, unknown>
}

/** The last encrypted sync response, persisted in storage.local for offline unlock and filling. */
export async function loadSync(accountId: string): Promise<StoredSync | null> {
  const key = syncKey(accountId)
  return (
    ((await browser.storage.local.get(key))[key] as StoredSync | undefined) ??
    null
  )
}

export async function saveSync(
  accountId: string,
  sync: StoredSync,
): Promise<void> {
  await browser.storage.local.set({
    [syncKey(accountId)]: sync,
    [syncedAtKey(accountId)]: sync.syncedAt,
  })
}

export async function loadSyncedAt(accountId: string): Promise<number | null> {
  const key = syncedAtKey(accountId)
  const syncedAt = (await browser.storage.local.get(key))[key]
  return typeof syncedAt === "number" ? syncedAt : null
}

/** Notes that the account was just used, for locking accounts that sit idle. */
export async function touchAccount(accountId: string): Promise<void> {
  await browser.storage.session.set({ [activityKey(accountId)]: Date.now() })
}

/** When each account was last used; an account not used in this browser session is missing. */
export async function lastActivity(
  accountIds: readonly string[],
): Promise<Record<string, number>> {
  const stored = await browser.storage.session.get(accountIds.map(activityKey))
  return Object.fromEntries(
    accountIds.flatMap((accountId) => {
      const at = stored[activityKey(accountId)]
      return typeof at === "number" ? [[accountId, at]] : []
    }),
  )
}

/** A random device ID, created once; the server lists signed-in devices by it. */
export async function deviceIdentifier(): Promise<string> {
  const stored = (await browser.storage.local.get(DEVICE_KEY))[DEVICE_KEY]
  if (typeof stored === "string") return stored
  const id = crypto.randomUUID()
  await browser.storage.local.set({ [DEVICE_KEY]: id })
  return id
}

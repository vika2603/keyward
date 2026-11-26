import { type TrashedItem, VaultError, type VaultGroups } from "../types"
import { type AccountSessions, apiOf } from "./account-session"
import { loadSync, loadSyncedAt, saveSync, touchAccount } from "./account-store"
import { valueAt } from "./api"
import type { VaultCrypto } from "./crypto"
import {
  decryptGroups,
  decryptLogin,
  decryptNote,
  decryptTrashed,
  type LoginItem,
  loginCiphers,
  type NoteItem,
  noteCiphers,
  trashedCiphers,
} from "./decrypt"
import { VaultKeys } from "./keys"

/** Synced data older than this is refreshed in the background when it is used. */
const SYNC_MAX_AGE_MS = 5 * 60_000

/** An unlocked account's items, decrypted as far as lists need, with the encrypted items they came from. */
export interface Vault {
  syncedAt: number
  keys: VaultKeys
  groups: VaultGroups
  trashed: TrashedItem[]
  trashedCiphers: Record<string, unknown>[]
  items: LoginItem[]
  ciphers: Record<string, unknown>[]
  notes: NoteItem[]
  noteCiphers: Record<string, unknown>[]
}

/** Decrypts each cipher; one that cannot be decrypted is left out rather than failing the list. */
function decryptEach<T>(
  ciphers: Record<string, unknown>[],
  decrypt: (cipher: Record<string, unknown>) => T,
): T[] {
  const decrypted: T[] = []
  for (const cipher of ciphers) {
    try {
      decrypted.push(decrypt(cipher))
    } catch {
      // An item that cannot be read is skipped.
    }
  }
  return decrypted
}

/**
 * Each unlocked account's synced items: fetched from its server, kept encrypted in storage.session,
 * and decrypted once per sync into memory, which a lock or sign-out clears.
 */
export class VaultCache {
  private readonly decrypted = new Map<string, Vault>()
  private readonly syncing = new Map<string, Promise<void>>()

  constructor(
    private readonly sessions: AccountSessions,
    private readonly loadCrypto: () => Promise<VaultCrypto>,
    /** Called after an account synced. */
    private readonly onSynced: () => void,
  ) {}

  forget(accountId: string): void {
    this.decrypted.delete(accountId)
  }

  /** Fetches the account's items; one sync runs per account at a time. */
  sync(accountId: string): Promise<void> {
    let running = this.syncing.get(accountId)
    if (!running) {
      running = this.fetch(accountId).finally(() =>
        this.syncing.delete(accountId),
      )
      this.syncing.set(accountId, running)
    }
    return running
  }

  private async fetch(accountId: string): Promise<void> {
    const accessEndsBefore = this.sessions.accessEndsOf(accountId)
    const account = await this.sessions.account(accountId)
    const data = await apiOf(account).sync(
      await this.sessions.accessToken(account),
    )
    // Saved right after the check, with no wait between, so a lock cannot slip in.
    if (this.sessions.accessEndsOf(accountId) !== accessEndsBefore)
      throw new VaultError("The account is locked", "locked")
    await saveSync(accountId, { syncedAt: Date.now(), data })
    this.forget(accountId)
    this.onSynced()
  }

  private refreshWhenOld(accountId: string, syncedAt: number): void {
    if (Date.now() - syncedAt > SYNC_MAX_AGE_MS)
      void this.sync(accountId).catch(() => {})
  }

  /**
   * The account's decrypted items: from memory while they belong to the last sync, else decrypted
   * from the stored sync, which is fetched first when there is none yet. Old data is refreshed in
   * the background. `passive` reads do not count as using the account.
   */
  async vault(accountId: string, passive = false): Promise<Vault> {
    const accessEndsBefore = this.sessions.accessEndsOf(accountId)
    const session = await this.sessions.unlockedSession(accountId)
    if (!passive) await touchAccount(accountId)
    const cached = this.decrypted.get(accountId)
    if (cached && cached.syncedAt === (await loadSyncedAt(accountId))) {
      this.refreshWhenOld(accountId, cached.syncedAt)
      return cached
    }
    let stored = await loadSync(accountId)
    if (!stored) {
      await this.sync(accountId)
      stored = await loadSync(accountId)
      if (!stored) throw new VaultError("No synced data", "bitwarden.noData")
    } else {
      this.refreshWhenOld(accountId, stored.syncedAt)
    }
    const keys = VaultKeys.fromProfile(
      await this.loadCrypto(),
      Uint8Array.fromBase64(session.userKey),
      valueAt(stored.data, "Profile"),
    )
    const ciphers = loginCiphers(stored.data)
    const noteCiphersOfVault = noteCiphers(stored.data)
    const trashedCiphersOfVault = trashedCiphers(stored.data)
    const vault: Vault = {
      syncedAt: stored.syncedAt,
      keys,
      groups: decryptGroups(stored.data, keys),
      trashed: decryptEach(trashedCiphersOfVault, (cipher) =>
        decryptTrashed(cipher, keys),
      ),
      trashedCiphers: trashedCiphersOfVault,
      items: decryptEach(ciphers, (cipher) => decryptLogin(cipher, keys)),
      ciphers,
      notes: decryptEach(noteCiphersOfVault, (cipher) =>
        decryptNote(cipher, keys),
      ),
      noteCiphers: noteCiphersOfVault,
    }
    // A lock while decrypting must not leave the keys and items in memory.
    if (this.sessions.accessEndsOf(accountId) === accessEndsBefore)
      this.decrypted.set(accountId, vault)
    return vault
  }
}

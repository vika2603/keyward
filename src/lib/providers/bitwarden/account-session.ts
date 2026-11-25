import { VaultError } from "../types"
import {
  type AccountSession,
  accountIdOf,
  clearSession,
  lastActivity,
  loadAccounts,
  loadSession,
  removeAccount,
  type StoredAccount,
  saveAccount,
  saveSession,
  touchAccount,
  updateAccount,
} from "./account-store"
import { ApiError, BitwardenApi, valueAt } from "./api"
import {
  type SignedIn,
  unwrapUserKey,
  userIdOf,
  wrappedUserKeyOf,
} from "./auth"
import { masterKeySalt, type VaultCrypto, WrongPasswordError } from "./crypto"
import { dropRepromptPasses } from "./reprompt-passes"
import { serverUrls } from "./server"
import { vaultIdOf } from "./vault-id"

/** Refresh the access token this long before it expires. */
const TOKEN_MARGIN_MS = 60_000
/** How long an access token lasts when the server does not say. */
const DEFAULT_TOKEN_LIFETIME_SECONDS = 3600

export function apiOf(account: StoredAccount): BitwardenApi {
  return new BitwardenApi(serverUrls(account.server, account.endpoints))
}

function expiryOf(token: Record<string, unknown>): number {
  const seconds = valueAt(token, "expires_in")
  const lifetime =
    typeof seconds === "number" ? seconds : DEFAULT_TOKEN_LIFETIME_SECONDS
  return Date.now() + lifetime * 1000
}

/**
 * The signed-in accounts and their unlocked sessions: unlocking with the master password, locking,
 * signing out and keeping each account's access token fresh.
 */
export class AccountSessions {
  private readonly refreshing = new Map<string, Promise<string>>()
  /**
   * How many times each account was locked or signed out in this worker. A sync or decryption that
   * started before a change of the count must leave nothing behind.
   */
  private readonly accessEnds = new Map<string, number>()

  constructor(
    private readonly loadCrypto: () => Promise<VaultCrypto>,
    /** Called as an account's access ends, to drop what was decrypted for it. */
    private readonly onAccessEnd: (accountId: string) => void,
  ) {}

  accessEndsOf(accountId: string): number {
    return this.accessEnds.get(accountId) ?? 0
  }

  private endAccess(accountId: string): void {
    this.accessEnds.set(accountId, this.accessEndsOf(accountId) + 1)
    this.onAccessEnd(accountId)
  }

  async account(accountId: string): Promise<StoredAccount> {
    const account = (await loadAccounts()).find(
      (stored) => stored.id === accountId,
    )
    if (!account) throw new VaultError("Unknown account", "unknownVault")
    return account
  }

  async unlockedSession(accountId: string): Promise<AccountSession> {
    const session = await loadSession(accountId)
    if (!session) throw new VaultError("The account is locked", "locked")
    return session
  }

  /** The account's user key, which only its master password unwraps. */
  async verifyMasterPassword(
    account: StoredAccount,
    password: string,
  ): Promise<{ vaultCrypto: VaultCrypto; userKey: Uint8Array }> {
    const vaultCrypto = await this.loadCrypto()
    const masterKey = vaultCrypto.deriveMasterKey(
      password,
      masterKeySalt(account.email, account.salt),
      account.kdf,
    )
    try {
      const userKey = await unwrapUserKey(
        vaultCrypto,
        account.wrappedUserKey,
        masterKey,
      )
      return { vaultCrypto, userKey }
    } catch (error) {
      if (error instanceof WrongPasswordError)
        throw new VaultError("Wrong master password", "bitwarden.wrongPassword")
      throw error
    }
  }

  /** Stores a new sign-in's account and its session, keeping a name the account had; returns its ID. */
  async establish(
    server: string,
    endpoints: StoredAccount["endpoints"],
    signedIn: SignedIn,
  ): Promise<string> {
    const vaultCrypto = await this.loadCrypto()
    const { token } = signedIn
    const accessToken = String(valueAt(token, "access_token"))
    const refreshToken = String(valueAt(token, "refresh_token"))
    const wrappedUserKey = wrappedUserKeyOf(token)
    const userKey = await unwrapUserKey(
      vaultCrypto,
      wrappedUserKey,
      signedIn.masterKey,
    )
    const userId = userIdOf(accessToken)
    const id = accountIdOf(server, userId)
    // Signing in again to an account keeps the name the user gave it.
    const previous = (await loadAccounts()).find((stored) => stored.id === id)
    await saveAccount({
      id,
      userId,
      email: signedIn.email,
      server,
      endpoints,
      name: previous?.name,
      kdf: signedIn.kdf,
      salt: signedIn.salt,
      wrappedUserKey,
      encryptedRefreshToken: vaultCrypto.encryptString(refreshToken, userKey),
    })
    await saveSession(id, {
      userKey: userKey.toBase64(),
      accessToken,
      accessTokenExpiresAt: expiryOf(token),
      refreshToken,
    })
    await touchAccount(id)
    return id
  }

  /** Unlocks one account with its master password; other accounts keep their state. */
  async unlock(accountId: string, password: string): Promise<void> {
    const account = await this.account(accountId)
    const { vaultCrypto, userKey } = await this.verifyMasterPassword(
      account,
      password,
    )
    const refreshToken = vaultCrypto.decryptString(
      account.encryptedRefreshToken,
      userKey,
    )
    await saveSession(account.id, {
      userKey: userKey.toBase64(),
      accessToken: "",
      accessTokenExpiresAt: 0,
      refreshToken,
    })
    await touchAccount(account.id)
  }

  async lock(accountId: string): Promise<void> {
    this.endAccess(accountId)
    await clearSession(accountId)
    await dropRepromptPasses(vaultIdOf(accountId))
  }

  async signOut(accountId: string): Promise<void> {
    this.endAccess(accountId)
    await removeAccount(accountId)
    await dropRepromptPasses(vaultIdOf(accountId))
  }

  /** The unlocked accounts that have not been used for `minutes`. */
  async idleAccounts(minutes: number): Promise<string[]> {
    const accounts = await loadAccounts()
    const activity = await lastActivity(accounts.map((account) => account.id))
    const cutoff = Date.now() - minutes * 60_000
    const idle: string[] = []
    for (const account of accounts) {
      if ((activity[account.id] ?? 0) >= cutoff) continue
      if (await loadSession(account.id)) idle.push(account.id)
    }
    return idle
  }

  /** A valid access token, refreshed when it is about to expire. */
  accessToken(account: StoredAccount): Promise<string> {
    let running = this.refreshing.get(account.id)
    if (!running) {
      running = this.refreshAccessToken(account).finally(() =>
        this.refreshing.delete(account.id),
      )
      this.refreshing.set(account.id, running)
    }
    return running
  }

  /**
   * Refreshes the access token when it is about to expire. One refresh runs per account at a time,
   * since a server that rotates refresh tokens rejects the second use of the old one.
   */
  private async refreshAccessToken(account: StoredAccount): Promise<string> {
    const session = await this.unlockedSession(account.id)
    if (
      session.accessToken &&
      session.accessTokenExpiresAt - TOKEN_MARGIN_MS > Date.now()
    ) {
      return session.accessToken
    }
    let token: Record<string, unknown>
    try {
      token = await apiOf(account).refreshToken(session.refreshToken)
    } catch (error) {
      if (error instanceof ApiError && error.isAuthError) {
        throw new VaultError(
          "The server signed this account out; sign in again",
          "bitwarden.signedOut",
        )
      }
      throw error
    }
    const accessToken = String(valueAt(token, "access_token"))
    const refreshed = valueAt(token, "refresh_token")
    const refreshToken =
      typeof refreshed === "string" ? refreshed : session.refreshToken
    // The account may have been locked or signed out while the request was under way; writing
    // the session back would undo that.
    const current = await this.unlockedSession(account.id)
    await saveSession(account.id, {
      ...current,
      accessToken,
      accessTokenExpiresAt: expiryOf(token),
      refreshToken,
    })
    if (refreshToken !== session.refreshToken) {
      const vaultCrypto = await this.loadCrypto()
      const userKey = Uint8Array.fromBase64(current.userKey)
      const encryptedRefreshToken = vaultCrypto.encryptString(
        refreshToken,
        userKey,
      )
      await updateAccount(account.id, (stored) => ({
        ...stored,
        encryptedRefreshToken,
      }))
    }
    return accessToken
  }
}

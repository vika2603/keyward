import { ruleForHost, uriMatches } from "@/lib/matching"
import { getSettings } from "@/lib/settings"
import {
  BackendError,
  type Credential,
  type ExistingLogin,
  type LoginSummary,
  type NewLogin,
  type PasswordBackend,
  type SourceInfo,
  type TabRef,
} from "../types"
import {
  type AccountSession,
  accountIdOf,
  clearSession,
  deviceIdentifier,
  loadAccounts,
  loadSession,
  loadSync,
  removeAccount,
  type StoredAccount,
  saveAccount,
  saveSession,
  saveSync,
} from "./account-store"
import { ApiError, BitwardenApi, type Device, prop } from "./api"
import {
  completeSecondStep,
  type PendingLogin,
  type SecondStepMethod,
  type SignedIn,
  signIn,
  unwrapUserKey,
  userIdOf,
  wrappedUserKeyOf,
} from "./auth"
import { masterKeySalt, type VaultCrypto, WrongPasswordError } from "./crypto"
import { serverUrls } from "./server"
import { accountIdOfSource, sourceIdOf } from "./source-id"
import {
  decryptLogin,
  decryptPassword,
  type LoginItem,
  loginCiphers,
  newLoginRequest,
  passwordUpdateRequest,
  VaultKeys,
} from "./vault"

const PENDING_LOGIN_KEY = "bitwarden.pendingLogin"
const ACTIVITY_KEY = "bitwarden.lastActivity"
/** Refresh the access token this long before it expires. */
const TOKEN_MARGIN_MS = 60_000
/** Synced data older than this is refreshed in the background when it is used. */
const SYNC_MAX_AGE_MS = 5 * 60_000

export interface AccountSummary {
  id: string
  sourceId: string
  email: string
  server: string
  unlocked: boolean
}

export interface PendingSignInView {
  server: string
  email: string
  methods: SecondStepMethod[]
}

export type SignInOutcome =
  | { kind: "signedIn"; accountId: string }
  | { kind: "secondStep"; pending: PendingSignInView }

interface PendingSignIn {
  server: string
  login: PendingLogin
}

interface Vault {
  syncedAt: number
  keys: VaultKeys
  items: LoginItem[]
  ciphers: Record<string, unknown>[]
}

/**
 * Accounts of Bitwarden-compatible servers, any number signed in at once. Each account is a source
 * of its own and is locked or unlocked on its own; unlocking one never locks another.
 */
export class BitwardenBackend implements PasswordBackend {
  readonly kind = "bitwarden" as const
  private readonly cache = new Map<string, Vault>()
  private readonly syncing = new Map<string, Promise<void>>()

  constructor(private readonly loadCrypto: () => Promise<VaultCrypto>) {}

  async accounts(): Promise<AccountSummary[]> {
    const accounts = await loadAccounts()
    return Promise.all(
      accounts.map(async (a) => ({
        id: a.id,
        sourceId: sourceIdOf(a.id),
        email: a.email,
        server: a.server,
        unlocked: (await loadSession(a.id)) !== null,
      })),
    )
  }

  async sources(): Promise<SourceInfo[]> {
    return (await this.accounts()).map((a) => ({
      id: a.sourceId,
      kind: "bitwarden",
      label: a.email,
      detail: a.server || "官方服务",
      status: a.unlocked ? "ready" : "locked",
    }))
  }

  private async device(): Promise<Device> {
    return { identifier: await deviceIdentifier(), name: "chrome" }
  }

  async signIn(
    server: string,
    credentials: { email: string; password: string },
  ): Promise<SignInOutcome> {
    await browser.storage.session.remove(PENDING_LOGIN_KEY)
    const api = new BitwardenApi(serverUrls(server))
    const step = await signIn(
      api,
      await this.loadCrypto(),
      await this.device(),
      credentials,
    )
    if (step.kind === "secondStep") {
      const pending: PendingSignIn = { server, login: step.pending }
      await browser.storage.session.set({ [PENDING_LOGIN_KEY]: pending })
      return { kind: "secondStep", pending: pendingView(pending) }
    }
    return {
      kind: "signedIn",
      accountId: await this.finishSignIn(server, step.result),
    }
  }

  private async storedPending(): Promise<PendingSignIn | null> {
    const stored = (await browser.storage.session.get(PENDING_LOGIN_KEY))[
      PENDING_LOGIN_KEY
    ]
    return (stored as PendingSignIn | undefined) ?? null
  }

  async pendingSignIn(): Promise<PendingSignInView | null> {
    const pending = await this.storedPending()
    return pending ? pendingView(pending) : null
  }

  async cancelSignIn(): Promise<void> {
    await browser.storage.session.remove(PENDING_LOGIN_KEY)
  }

  private async requirePending(): Promise<PendingSignIn> {
    const pending = await this.storedPending()
    if (!pending)
      throw new BackendError(
        "No sign-in is waiting for a code",
        "bitwarden.noPendingSignIn",
      )
    return pending
  }

  async sendEmailCode(): Promise<void> {
    const { server, login } = await this.requirePending()
    await new BitwardenApi(serverUrls(server)).sendEmailCode(
      { email: login.email, passwordHash: login.passwordHash },
      await this.device(),
    )
  }

  async submitSecondStep(
    method: SecondStepMethod,
    code: string,
  ): Promise<string> {
    const pending = await this.requirePending()
    if (!pending.login.methods.includes(method))
      throw new BackendError("Unsupported method", "bitwarden.method")
    const api = new BitwardenApi(serverUrls(pending.server))
    const result = await completeSecondStep(
      api,
      await this.device(),
      pending.login,
      method,
      code,
    )
    await browser.storage.session.remove(PENDING_LOGIN_KEY)
    return this.finishSignIn(pending.server, result)
  }

  private async finishSignIn(
    server: string,
    signedIn: SignedIn,
  ): Promise<string> {
    const crypto = await this.loadCrypto()
    const { token } = signedIn
    const accessToken = String(prop(token, "access_token"))
    const refreshToken = String(prop(token, "refresh_token"))
    const wrappedUserKey = wrappedUserKeyOf(token)
    const userKey = await unwrapUserKey(
      crypto,
      wrappedUserKey,
      signedIn.masterKey,
    )
    const userId = userIdOf(accessToken)
    const account: StoredAccount = {
      id: accountIdOf(server, userId),
      userId,
      email: signedIn.email,
      server,
      kdf: signedIn.kdf,
      salt: signedIn.salt,
      wrappedUserKey,
      encryptedRefreshToken: crypto.encryptString(refreshToken, userKey),
    }
    await saveAccount(account)
    await saveSession(account.id, {
      userKey: userKey.toBase64(),
      accessToken,
      accessTokenExpiresAt: expiryOf(token),
      refreshToken,
    })
    await this.touch(account.id)
    await this.sync(account.id).catch(() => {})
    return account.id
  }

  /** Unlocks one account with its master password; other accounts keep their state. */
  async unlock(accountId: string, password: string): Promise<void> {
    const account = await this.account(accountId)
    const crypto = await this.loadCrypto()
    const masterKey = crypto.deriveMasterKey(
      password,
      masterKeySalt(account.email, account.salt),
      account.kdf,
    )
    let userKey: Uint8Array
    try {
      userKey = await unwrapUserKey(crypto, account.wrappedUserKey, masterKey)
    } catch (error) {
      if (error instanceof WrongPasswordError) {
        throw new BackendError(
          "Wrong master password",
          "bitwarden.wrongPassword",
        )
      }
      throw error
    }
    const refreshToken = crypto.decryptString(
      account.encryptedRefreshToken,
      userKey,
    )
    await saveSession(account.id, {
      userKey: userKey.toBase64(),
      accessToken: "",
      accessTokenExpiresAt: 0,
      refreshToken,
    })
    await this.touch(account.id)
    void this.sync(account.id).catch(() => {})
  }

  async lock(accountId: string): Promise<void> {
    this.cache.delete(accountId)
    await clearSession(accountId)
  }

  async lockAll(): Promise<void> {
    for (const account of await loadAccounts()) await this.lock(account.id)
  }

  async signOut(accountId: string): Promise<void> {
    this.cache.delete(accountId)
    await removeAccount(accountId)
  }

  /** Locks accounts that have not been used for `minutes`. */
  async lockIdle(minutes: number): Promise<void> {
    const activity = await this.activity()
    const cutoff = Date.now() - minutes * 60_000
    for (const account of await loadAccounts()) {
      if (
        (activity[account.id] ?? 0) < cutoff &&
        (await loadSession(account.id))
      ) {
        await this.lock(account.id)
      }
    }
  }

  private async activity(): Promise<Record<string, number>> {
    const stored = (await browser.storage.session.get(ACTIVITY_KEY))[
      ACTIVITY_KEY
    ]
    return (stored as Record<string, number> | undefined) ?? {}
  }

  private async touch(accountId: string): Promise<void> {
    await browser.storage.session.set({
      [ACTIVITY_KEY]: { ...(await this.activity()), [accountId]: Date.now() },
    })
  }

  private async account(accountId: string): Promise<StoredAccount> {
    const account = (await loadAccounts()).find((a) => a.id === accountId)
    if (!account) throw new BackendError("Unknown account", "unknownSource")
    return account
  }

  private async unlockedSession(accountId: string): Promise<AccountSession> {
    const session = await loadSession(accountId)
    if (!session) throw new BackendError("The account is locked", "locked")
    return session
  }

  /** A valid access token, refreshed when it is about to expire. */
  private async accessToken(account: StoredAccount): Promise<string> {
    const session = await this.unlockedSession(account.id)
    if (
      session.accessToken &&
      session.accessTokenExpiresAt - TOKEN_MARGIN_MS > Date.now()
    ) {
      return session.accessToken
    }
    const api = new BitwardenApi(serverUrls(account.server))
    let token: Record<string, unknown>
    try {
      token = await api.refreshToken(session.refreshToken)
    } catch (error) {
      if (error instanceof ApiError && error.isAuthError) {
        throw new BackendError(
          "The server signed this account out; sign in again",
          "bitwarden.signedOut",
        )
      }
      throw error
    }
    const accessToken = String(prop(token, "access_token"))
    const refreshed = prop(token, "refresh_token")
    const refreshToken =
      typeof refreshed === "string" ? refreshed : session.refreshToken
    await saveSession(account.id, {
      ...session,
      accessToken,
      accessTokenExpiresAt: expiryOf(token),
      refreshToken,
    })
    if (refreshToken !== session.refreshToken) {
      const crypto = await this.loadCrypto()
      const userKey = Uint8Array.fromBase64(session.userKey)
      await saveAccount({
        ...account,
        encryptedRefreshToken: crypto.encryptString(refreshToken, userKey),
      })
    }
    return accessToken
  }

  sync(accountId: string): Promise<void> {
    let running = this.syncing.get(accountId)
    if (!running) {
      running = (async () => {
        const account = await this.account(accountId)
        const api = new BitwardenApi(serverUrls(account.server))
        const data = await api.sync(await this.accessToken(account))
        await saveSync(accountId, { syncedAt: Date.now(), data })
        this.cache.delete(accountId)
      })().finally(() => this.syncing.delete(accountId))
      this.syncing.set(accountId, running)
    }
    return running
  }

  /** Decrypted item summaries; synced first when there is no data yet, refreshed in the background when old. */
  private async vault(accountId: string): Promise<Vault> {
    const session = await this.unlockedSession(accountId)
    await this.touch(accountId)
    let stored = await loadSync(accountId)
    if (!stored) {
      await this.sync(accountId)
      stored = await loadSync(accountId)
      if (!stored) throw new BackendError("No synced data", "bitwarden.noData")
    } else if (Date.now() - stored.syncedAt > SYNC_MAX_AGE_MS) {
      void this.sync(accountId).catch(() => {})
    }
    const cached = this.cache.get(accountId)
    if (cached && cached.syncedAt === stored.syncedAt) return cached
    const crypto = await this.loadCrypto()
    const keys = VaultKeys.fromProfile(
      crypto,
      Uint8Array.fromBase64(session.userKey),
      prop(stored.data, "Profile"),
    )
    const ciphers = loginCiphers(stored.data)
    const items: LoginItem[] = []
    for (const cipher of ciphers) {
      try {
        items.push(decryptLogin(cipher, keys))
      } catch {
        // An item that cannot be decrypted is left out rather than failing the whole list.
      }
    }
    const vault = { syncedAt: stored.syncedAt, keys, items, ciphers }
    this.cache.set(accountId, vault)
    return vault
  }

  private async matching(
    accountId: string,
    page: URL,
  ): Promise<{ vault: Vault; items: LoginItem[] }> {
    const vault = await this.vault(accountId)
    const settings = await getSettings()
    const rule = ruleForHost(settings.siteRules, page.hostname)
    const options = {
      defaultMatch: settings.defaultMatch,
      equivalentDomains: settings.equivalentDomains,
    }
    const items = vault.items.filter((item) =>
      item.uris.some((u) =>
        uriMatches(u.uri, rule?.match ?? u.match, page, options),
      ),
    )
    return { vault, items }
  }

  async logins(sourceId: string, page: URL): Promise<LoginSummary[]> {
    const { items } = await this.matching(accountIdOfSource(sourceId), page)
    return items.map((item) => ({
      id: item.id,
      username: item.username,
      title: item.name,
    }))
  }

  /** Reads a login's password; the login must match the page it is read for. */
  async credential(
    sourceId: string,
    loginId: string,
    page: URL,
    _tab: TabRef,
  ): Promise<Credential> {
    const { vault, items } = await this.matching(
      accountIdOfSource(sourceId),
      page,
    )
    const item = items.find((i) => i.id === loginId)
    const cipher = vault.ciphers.find((c) => prop(c, "Id") === loginId)
    if (!item || !cipher)
      throw new BackendError("The login does not match this page", "notFound")
    return {
      username: item.username,
      password: decryptPassword(cipher, vault.keys),
    }
  }

  async findExisting(
    sourceId: string,
    page: URL,
    username: string,
    password: string,
  ): Promise<ExistingLogin | null> {
    const { vault, items } = await this.matching(
      accountIdOfSource(sourceId),
      page,
    )
    const item = items.find((i) => i.username === username)
    if (!item) return null
    const cipher = vault.ciphers.find((c) => prop(c, "Id") === item.id)
    const saved = cipher ? decryptPassword(cipher, vault.keys) : undefined
    return {
      loginId: item.id,
      samePassword: saved === undefined ? undefined : saved === password,
    }
  }

  async save(sourceId: string, login: NewLogin, _tab: TabRef): Promise<void> {
    const accountId = accountIdOfSource(sourceId)
    const account = await this.account(accountId)
    const { keys } = await this.vault(accountId)
    const api = new BitwardenApi(serverUrls(account.server))
    await api.createCipher(
      await this.accessToken(account),
      newLoginRequest(
        {
          name: login.url.hostname,
          username: login.username,
          password: login.password,
          uri: login.url.origin,
        },
        keys,
        account.userId,
      ),
    )
    await this.sync(accountId)
  }

  async update(
    sourceId: string,
    loginId: string,
    login: NewLogin,
    _tab: TabRef,
  ): Promise<void> {
    const accountId = accountIdOfSource(sourceId)
    const account = await this.account(accountId)
    const { keys, ciphers } = await this.vault(accountId)
    const cipher = ciphers.find((c) => prop(c, "Id") === loginId)
    if (!cipher) throw new BackendError("Unknown login", "notFound")
    const api = new BitwardenApi(serverUrls(account.server))
    await api.updateCipher(
      await this.accessToken(account),
      loginId,
      passwordUpdateRequest(cipher, login.password, keys, account.userId),
    )
    await this.sync(accountId)
  }
}

function pendingView(pending: PendingSignIn): PendingSignInView {
  return {
    server: pending.server,
    email: pending.login.email,
    methods: pending.login.methods,
  }
}

function expiryOf(token: Record<string, unknown>): number {
  const seconds = prop(token, "expires_in")
  return Date.now() + (typeof seconds === "number" ? seconds : 3600) * 1000
}

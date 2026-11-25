import { ruleForHost, uriMatches } from "@/lib/matching"
import { getSettings } from "@/lib/settings"
import { hostOfSavedUri } from "@/lib/site"
import { oneTimeCode } from "@/lib/totp"
import {
  type Credential,
  type CustomField,
  type EditableLogin,
  type EditableNote,
  type ExistingLogin,
  type FillField,
  type Folder,
  type ListOptions,
  type LoginDetails,
  type LoginEdit,
  type LoginSummary,
  type NewLogin,
  type NoteDetails,
  type NoteSummary,
  type OneTimeCode,
  type PastPassword,
  type TabRef,
  type TrashedItem,
  VaultError,
  type VaultGroups,
  type VaultInfo,
  type VaultProvider,
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
  setAccountName,
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
import { type CustomEndpoints, serverHost, serverUrls } from "./server"
import {
  decryptDetails,
  decryptGroups,
  decryptLogin,
  decryptNote,
  decryptPassword,
  decryptPasswordHistory,
  decryptTotp,
  decryptTrashed,
  type ItemChange,
  itemUpdateRequest,
  type LoginItem,
  loginCiphers,
  matchesQuery,
  type NoteItem,
  newLoginRequest,
  newNoteRequest,
  noteCiphers,
  textMatchesQuery,
  trashedCiphers,
  VaultKeys,
} from "./vault"
import { accountIdOfVault, vaultIdOf } from "./vault-id"

const PENDING_LOGIN_KEY = "bitwarden.pendingLogin"
/** Items whose master password was entered again, by `vaultId|itemId`, with when the pass ends. */
const REPROMPT_PASSES_KEY = "bitwarden.repromptPasses"
/**
 * How long an item stays open after its master password was entered again, so viewing it and
 * copying from it do not each ask. Keyward's choice; Bitwarden's apps ask for each action.
 */
const REPROMPT_PASS_MS = 5 * 60_000
const ACTIVITY_KEY = "bitwarden.lastActivity"
/** Refresh the access token this long before it expires. */
const TOKEN_MARGIN_MS = 60_000
/** Synced data older than this is refreshed in the background when it is used. */
const SYNC_MAX_AGE_MS = 5 * 60_000

export interface AccountSummary {
  id: string
  vaultId: string
  email: string
  server: string
  /** The name the user gave the account; empty when there is none. */
  name: string
  /** What the interface calls the account: its name, else its email address. */
  label: string
  unlocked: boolean
  /** When the account's items were last fetched from its server, while it is unlocked. */
  syncedAt?: number
}

export interface PendingSignInView {
  server: string
  endpoints?: CustomEndpoints
  email: string
  methods: SecondStepMethod[]
}

export type SignInOutcome =
  | { kind: "signedIn"; accountId: string }
  | { kind: "secondStep"; pending: PendingSignInView }

interface PendingSignIn {
  server: string
  endpoints?: CustomEndpoints
  login: PendingLogin
}

interface Vault {
  syncedAt: number
  keys: VaultKeys
  groups: VaultGroups
  trashed: TrashedItem[]
  items: LoginItem[]
  ciphers: Record<string, unknown>[]
  notes: NoteItem[]
  noteCiphers: Record<string, unknown>[]
}

/**
 * Accounts of Bitwarden-compatible servers, any number signed in at once. Each account is a vault
 * of its own and is locked or unlocked on its own; unlocking one never locks another.
 */
export class BitwardenProvider implements VaultProvider {
  readonly kind = "bitwarden" as const
  private readonly cache = new Map<string, Vault>()
  private readonly syncing = new Map<string, Promise<void>>()
  private readonly refreshing = new Map<string, Promise<string>>()
  private readonly listeners = new Set<() => void>()

  constructor(private readonly loadCrypto: () => Promise<VaultCrypto>) {}

  /** Calls `listener` after an account is unlocked, locked or synced. */
  onChange(listener: () => void): void {
    this.listeners.add(listener)
  }

  private changed(): void {
    for (const listener of this.listeners) listener()
  }

  async accounts(): Promise<AccountSummary[]> {
    const accounts = await loadAccounts()
    return Promise.all(
      accounts.map(async (account) => ({
        id: account.id,
        vaultId: vaultIdOf(account.id),
        email: account.email,
        server: account.server,
        name: account.name ?? "",
        label: accountLabel(account, accounts),
        unlocked: (await loadSession(account.id)) !== null,
        syncedAt: (await loadSync(account.id))?.syncedAt,
      })),
    )
  }

  async vaults(): Promise<VaultInfo[]> {
    return (await this.accounts()).map((account) => ({
      id: account.vaultId,
      kind: "bitwarden",
      label: account.label,
      status: account.unlocked ? "ready" : "locked",
    }))
  }

  /** Gives an account the name the interface shows for it; an empty name goes back to the email. */
  async renameAccount(accountId: string, name: string): Promise<void> {
    await setAccountName(accountId, name.trim())
    this.changed()
  }

  private async device(): Promise<Device> {
    return { identifier: await deviceIdentifier(), name: "chrome" }
  }

  async signIn(
    server: string,
    credentials: { email: string; password: string },
    endpoints?: CustomEndpoints,
  ): Promise<SignInOutcome> {
    await browser.storage.session.remove(PENDING_LOGIN_KEY)
    const api = new BitwardenApi(serverUrls(server, endpoints))
    const step = await signIn(
      api,
      await this.loadCrypto(),
      await this.device(),
      credentials,
    )
    if (step.kind === "secondStep") {
      const pending: PendingSignIn = { server, endpoints, login: step.pending }
      await browser.storage.session.set({ [PENDING_LOGIN_KEY]: pending })
      return { kind: "secondStep", pending: pendingView(pending) }
    }
    return {
      kind: "signedIn",
      accountId: await this.finishSignIn(server, endpoints, step.result),
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
      throw new VaultError(
        "No sign-in is waiting for a code",
        "bitwarden.noPendingSignIn",
      )
    return pending
  }

  async sendEmailCode(): Promise<void> {
    const { server, endpoints, login } = await this.requirePending()
    await new BitwardenApi(serverUrls(server, endpoints)).sendEmailCode(
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
      throw new VaultError("Unsupported method", "bitwarden.method")
    const api = new BitwardenApi(serverUrls(pending.server, pending.endpoints))
    const result = await completeSecondStep(
      api,
      await this.device(),
      pending.login,
      method,
      code,
    )
    await browser.storage.session.remove(PENDING_LOGIN_KEY)
    return this.finishSignIn(pending.server, pending.endpoints, result)
  }

  private async finishSignIn(
    server: string,
    endpoints: CustomEndpoints | undefined,
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
    const id = accountIdOf(server, userId)
    // Signing in again to an account keeps the name the user gave it.
    const previous = (await loadAccounts()).find((stored) => stored.id === id)
    const account: StoredAccount = {
      id,
      userId,
      email: signedIn.email,
      server,
      endpoints,
      name: previous?.name,
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
    this.changed()
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
        throw new VaultError("Wrong master password", "bitwarden.wrongPassword")
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
    this.changed()
    void this.sync(account.id).catch(() => {})
  }

  async lock(vaultId: string): Promise<void> {
    await this.lockAccount(accountIdOfVault(vaultId))
  }

  async lockAll(): Promise<void> {
    for (const account of await loadAccounts())
      await this.lockAccount(account.id)
  }

  private async lockAccount(accountId: string): Promise<void> {
    this.cache.delete(accountId)
    await clearSession(accountId)
    await this.dropRepromptPasses(vaultIdOf(accountId))
    this.changed()
  }

  private async repromptPasses(): Promise<Record<string, number>> {
    const stored = (await browser.storage.session.get(REPROMPT_PASSES_KEY))[
      REPROMPT_PASSES_KEY
    ]
    return stored && typeof stored === "object"
      ? (stored as Record<string, number>)
      : {}
  }

  private async dropRepromptPasses(vaultId: string): Promise<void> {
    const passes = await this.repromptPasses()
    const kept = Object.fromEntries(
      Object.entries(passes).filter(([key]) => !key.startsWith(`${vaultId}|`)),
    )
    await browser.storage.session.set({ [REPROMPT_PASSES_KEY]: kept })
  }

  /** The item as Keyward may treat it: one whose master password was entered again acts as open. */
  private async withPass<T extends RepromptItem & { id: string }>(
    vaultId: string,
    item: T,
  ): Promise<T> {
    if (!item.reprompt) return item
    const until = (await this.repromptPasses())[`${vaultId}|${item.id}`]
    return until !== undefined && until > Date.now()
      ? { ...item, reprompt: false }
      : item
  }

  /**
   * Opens an item that asks for the master password again, for a few minutes, once the password
   * proves right. The password is checked here as an unlock checks it; nothing is sent anywhere.
   */
  async passReprompt(
    vaultId: string,
    itemId: string,
    password: string,
  ): Promise<void> {
    const accountId = accountIdOfVault(vaultId)
    const { items, notes } = await this.vault(accountId)
    if (![...items, ...notes].some((item) => item.id === itemId))
      throw new VaultError("Unknown item", "notFound")
    const account = await this.account(accountId)
    const crypto = await this.loadCrypto()
    const masterKey = crypto.deriveMasterKey(
      password,
      masterKeySalt(account.email, account.salt),
      account.kdf,
    )
    try {
      await unwrapUserKey(crypto, account.wrappedUserKey, masterKey)
    } catch (error) {
      if (error instanceof WrongPasswordError)
        throw new VaultError("Wrong master password", "bitwarden.wrongPassword")
      throw error
    }
    const now = Date.now()
    const passes = Object.fromEntries(
      Object.entries(await this.repromptPasses()).filter(
        ([, until]) => until > now,
      ),
    )
    passes[`${vaultId}|${itemId}`] = now + REPROMPT_PASS_MS
    await browser.storage.session.set({ [REPROMPT_PASSES_KEY]: passes })
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
        await this.lockAccount(account.id)
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
    if (!account) throw new VaultError("Unknown account", "unknownVault")
    return account
  }

  private async unlockedSession(accountId: string): Promise<AccountSession> {
    const session = await loadSession(accountId)
    if (!session) throw new VaultError("The account is locked", "locked")
    return session
  }

  /** A valid access token, refreshed when it is about to expire. */
  private accessToken(account: StoredAccount): Promise<string> {
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
    const api = new BitwardenApi(serverUrls(account.server, account.endpoints))
    let token: Record<string, unknown>
    try {
      token = await api.refreshToken(session.refreshToken)
    } catch (error) {
      if (error instanceof ApiError && error.isAuthError) {
        throw new VaultError(
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
    // The account may have been locked or signed out while the request was under way; writing
    // the session back would undo that.
    const current = await loadSession(account.id)
    if (!current) throw new VaultError("The account is locked", "locked")
    await saveSession(account.id, {
      ...current,
      accessToken,
      accessTokenExpiresAt: expiryOf(token),
      refreshToken,
    })
    const stored = (await loadAccounts()).find((a) => a.id === account.id)
    if (stored && refreshToken !== session.refreshToken) {
      const crypto = await this.loadCrypto()
      const userKey = Uint8Array.fromBase64(current.userKey)
      await saveAccount({
        ...stored,
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
        const api = new BitwardenApi(
          serverUrls(account.server, account.endpoints),
        )
        const data = await api.sync(await this.accessToken(account))
        await saveSync(accountId, { syncedAt: Date.now(), data })
        this.cache.delete(accountId)
        this.changed()
      })().finally(() => this.syncing.delete(accountId))
      this.syncing.set(accountId, running)
    }
    return running
  }

  /** Decrypted item summaries; synced first when there is no data yet, refreshed in the background when old. */
  private async vault(accountId: string, passive = false): Promise<Vault> {
    const session = await this.unlockedSession(accountId)
    if (!passive) await this.touch(accountId)
    let stored = await loadSync(accountId)
    if (!stored) {
      await this.sync(accountId)
      stored = await loadSync(accountId)
      if (!stored) throw new VaultError("No synced data", "bitwarden.noData")
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
    const items = decryptEach(ciphers, (cipher) => decryptLogin(cipher, keys))
    const noteCiphersOfVault = noteCiphers(stored.data)
    const notes = decryptEach(noteCiphersOfVault, (cipher) =>
      decryptNote(cipher, keys),
    )
    const vault = {
      syncedAt: stored.syncedAt,
      keys,
      groups: decryptGroups(stored.data, keys),
      trashed: decryptEach(trashedCiphers(stored.data), (cipher) =>
        decryptTrashed(cipher, keys),
      ),
      items,
      ciphers,
      notes,
      noteCiphers: noteCiphersOfVault,
    }
    this.cache.set(accountId, vault)
    return vault
  }

  private async matching(
    accountId: string,
    page: URL,
    passive = false,
  ): Promise<{ vault: Vault; items: LoginItem[] }> {
    const vault = await this.vault(accountId, passive)
    const settings = await getSettings()
    const rule = ruleForHost(settings.siteRules, page.hostname)
    const options = {
      defaultMatch: settings.defaultMatch,
      equivalentDomains: settings.equivalentDomains,
    }
    const items = vault.items.filter((item) =>
      item.uris.some((u) =>
        uriMatches(u.uri, u.match ?? rule?.match ?? null, page, options),
      ),
    )
    return { vault, items }
  }

  async logins(
    vaultId: string,
    page: URL,
    options?: ListOptions,
  ): Promise<LoginSummary[]> {
    const { items } = await this.matching(
      accountIdOfVault(vaultId),
      page,
      options?.passive,
    )
    return items.map(summaryOf)
  }

  async search(vaultId: string, query: string): Promise<LoginSummary[]> {
    const { items } = await this.vault(accountIdOfVault(vaultId))
    return items
      .filter((item) => matchesQuery(item, query))
      .sort((first, second) => first.name.localeCompare(second.name))
      .map(summaryOf)
  }

  /** Every login and note of the account, as the popup lists them when browsing the vault. */
  async allItems(vaultId: string): Promise<{
    logins: LoginSummary[]
    notes: NoteSummary[]
    groups: VaultGroups
    trashed: TrashedItem[]
  }> {
    const { items, notes, groups, trashed } = await this.vault(
      accountIdOfVault(vaultId),
    )
    return {
      logins: items.map(summaryOf),
      notes: notes.map(noteSummaryOf),
      groups,
      trashed,
    }
  }

  async searchNotes(vaultId: string, query: string): Promise<NoteSummary[]> {
    const { notes } = await this.vault(accountIdOfVault(vaultId))
    return notes
      .filter((note) => textMatchesQuery(note.name, query))
      .sort((first, second) => first.name.localeCompare(second.name))
      .map(noteSummaryOf)
  }

  private async noteEntry(
    vaultId: string,
    noteId: string,
  ): Promise<{
    vault: Vault
    note: NoteItem
    cipher: Record<string, unknown>
  }> {
    const vault = await this.vault(accountIdOfVault(vaultId))
    const note = vault.notes.find((candidate) => candidate.id === noteId)
    const cipher = vault.noteCiphers.find(
      (candidate) => prop(candidate, "Id") === noteId,
    )
    if (!note || !cipher) throw new VaultError("Unknown note", "notFound")
    return { vault, note: await this.withPass(vaultId, note), cipher }
  }

  /** The login or note an item ID names. */
  private async anyItem(
    vaultId: string,
    itemId: string,
  ): Promise<{ item: RepromptItem; cipher: Record<string, unknown> }> {
    const { notes } = await this.vault(accountIdOfVault(vaultId))
    const isNote = notes.some((note) => note.id === itemId)
    if (!isNote) return this.pageItem(vaultId, itemId, null)
    const { note, cipher } = await this.noteEntry(vaultId, itemId)
    return { item: note, cipher }
  }

  async note(vaultId: string, noteId: string): Promise<NoteDetails> {
    const { vault, note, cipher } = await this.noteEntry(vaultId, noteId)
    const details = decryptDetails(cipher, vault.keys)
    return {
      name: note.name,
      // Like a login's secrets, a re-prompted note's contents stay in Bitwarden's own apps.
      text: note.reprompt ? undefined : details.notes,
      customFields: note.reprompt ? undefined : details.customFields,
      withheld: note.reprompt,
      editable: isEditable(note, cipher),
      favorite: note.favorite,
      created: details.created,
      modified: details.modified,
    }
  }

  async editableNote(vaultId: string, noteId: string): Promise<EditableNote> {
    const { vault, note, cipher } = await this.noteEntry(vaultId, noteId)
    refuseEdit(note, cipher)
    const { notes, customFields } = decryptDetails(cipher, vault.keys)
    return { name: note.name, text: notes, customFields }
  }

  async saveNote(vaultId: string, note: EditableNote): Promise<void> {
    const accountId = accountIdOfVault(vaultId)
    const account = await this.account(accountId)
    const { keys } = await this.vault(accountId)
    await new BitwardenApi(
      serverUrls(account.server, account.endpoints),
    ).createCipher(
      await this.accessToken(account),
      newNoteRequest(note, keys, account.userId),
    )
    await this.sync(accountId)
  }

  /** Saves the parts of the note that differ from what is saved. */
  async editNote(
    vaultId: string,
    noteId: string,
    next: EditableNote,
  ): Promise<void> {
    const current = await this.editableNote(vaultId, noteId)
    const changed: ItemChange = {}
    if (next.name !== current.name) changed.name = next.name
    if (next.text !== current.text) changed.notes = next.text
    const fieldsChanged =
      JSON.stringify(next.customFields) !== JSON.stringify(current.customFields)
    if (fieldsChanged) changed.customFields = next.customFields
    if (!Object.keys(changed).length) return
    const { cipher } = await this.noteEntry(vaultId, noteId)
    await this.change(vaultId, cipher, changed)
  }

  /**
   * A login with its encrypted item. With a page, only a login of that page is found; without one,
   * any login of the vault, for Keyward's own views.
   */
  private async pageItem(
    vaultId: string,
    loginId: string,
    page: URL | null,
  ): Promise<{
    vault: Vault
    item: LoginItem
    cipher: Record<string, unknown>
  }> {
    const accountId = accountIdOfVault(vaultId)
    const { vault, items } = page
      ? await this.matching(accountId, page)
      : await this.vault(accountId).then((v) => ({ vault: v, items: v.items }))
    const item = items.find((i) => i.id === loginId)
    const cipher = vault.ciphers.find((c) => prop(c, "Id") === loginId)
    if (!item || !cipher)
      throw new VaultError("The login does not match this page", "notFound")
    return { vault, item: await this.withPass(vaultId, item), cipher }
  }

  async credential(
    vaultId: string,
    loginId: string,
    page: URL | null,
    _tab: TabRef,
  ): Promise<Credential> {
    const { vault, item, cipher } = await this.pageItem(vaultId, loginId, page)
    refuseReprompt(item)
    const { customFields } = decryptDetails(cipher, vault.keys)
    const password = decryptPassword(cipher, vault.keys)
    return {
      username: item.username,
      password,
      fields: fillFields(customFields, { username: item.username, password }),
    }
  }

  async details(
    vaultId: string,
    loginId: string,
    page: URL | null,
  ): Promise<LoginDetails> {
    const { vault, item, cipher } = await this.pageItem(vaultId, loginId, page)
    const details = decryptDetails(cipher, vault.keys)
    return {
      username: item.username,
      name: item.name,
      uris: item.uris.map((u) => u.uri).filter((uri) => uri !== ""),
      // Notes, fields and earlier passwords may hold secrets too, so a re-prompted item keeps them back.
      notes: item.reprompt ? undefined : details.notes || undefined,
      customFields: item.reprompt ? undefined : details.customFields,
      pastPasswordCount: item.reprompt ? undefined : details.pastPasswordCount,
      hasCode: item.hasTotp,
      secretsWithheld: item.reprompt,
      editable: isEditable(item, cipher),
      favorite: item.favorite,
      created: details.created,
      modified: details.modified,
      passwordModified: details.passwordModified,
    }
  }

  async passwordHistory(
    vaultId: string,
    loginId: string,
  ): Promise<PastPassword[]> {
    const { vault, item, cipher } = await this.pageItem(vaultId, loginId, null)
    refuseReprompt(item)
    return decryptPasswordHistory(cipher, vault.keys)
  }

  async codeLogins(vaultId: string, page: URL): Promise<LoginSummary[]> {
    return (await this.logins(vaultId, page)).filter((l) => l.hasCode)
  }

  async oneTimeCode(
    vaultId: string,
    loginId: string,
    page: URL | null,
    _tab: TabRef,
  ): Promise<OneTimeCode> {
    const { vault, item, cipher } = await this.pageItem(vaultId, loginId, page)
    refuseReprompt(item)
    const key = item.hasTotp ? decryptTotp(cipher, vault.keys) : ""
    if (!key)
      throw new VaultError("The login has no authenticator key", "noCode")
    try {
      return oneTimeCode(key)
    } catch {
      throw new VaultError(
        "The authenticator key cannot be read",
        "invalidCodeKey",
      )
    }
  }

  /** Stores an authenticator key in a login of the page, replacing the one it has. */
  async setCode(
    vaultId: string,
    loginId: string,
    page: URL,
    key: string,
  ): Promise<void> {
    requireCodeKey(key)
    const { item, cipher } = await this.pageItem(vaultId, loginId, page)
    refuseReprompt(item)
    await this.change(vaultId, cipher, { totp: key })
  }

  async editable(vaultId: string, loginId: string): Promise<EditableLogin> {
    const { vault, item, cipher } = await this.pageItem(vaultId, loginId, null)
    refuseEdit(item, cipher)
    const { notes, customFields } = decryptDetails(cipher, vault.keys)
    return {
      name: item.name,
      username: item.username,
      password: decryptPassword(cipher, vault.keys),
      uris: item.uris
        .filter((website) => website.uri !== "")
        .map(({ uri, match }) => ({ uri, match })),
      notes,
      totp: item.hasTotp ? decryptTotp(cipher, vault.keys) : "",
      customFields,
    }
  }

  /** Saves the fields that differ from the item's; an unchanged password stays out of the history. */
  async edit(
    vaultId: string,
    loginId: string,
    change: LoginEdit,
  ): Promise<void> {
    const current = await this.editable(vaultId, loginId)
    const changed: ItemChange = {}
    for (const key of ["name", "username", "password", "notes"] as const) {
      const value = change[key]
      if (value !== undefined && value !== current[key]) changed[key] = value
    }
    if (change.totp !== undefined && change.totp.trim() !== current.totp) {
      if (change.totp.trim()) requireCodeKey(change.totp.trim())
      changed.totp = change.totp.trim()
    }
    const uris = change.uris
      ?.map((website) => ({ ...website, uri: website.uri.trim() }))
      .filter((website) => website.uri !== "")
    if (
      uris !== undefined &&
      JSON.stringify(uris) !== JSON.stringify(current.uris)
    )
      changed.uris = uris
    const fieldsChanged =
      change.customFields !== undefined &&
      JSON.stringify(change.customFields) !==
        JSON.stringify(current.customFields)
    if (fieldsChanged) changed.customFields = change.customFields
    if (!Object.keys(changed).length) return
    const { cipher } = await this.pageItem(vaultId, loginId, null)
    await this.change(vaultId, cipher, changed)
  }

  async setFavorite(
    vaultId: string,
    itemId: string,
    favorite: boolean,
  ): Promise<void> {
    const accountId = accountIdOfVault(vaultId)
    const account = await this.account(accountId)
    const { cipher } = await this.anyItem(vaultId, itemId)
    // The request sets the folder as well, so the item's own goes with it.
    const folderId = prop(cipher, "FolderId")
    await new BitwardenApi(
      serverUrls(account.server, account.endpoints),
    ).updateCipherPartial(await this.accessToken(account), itemId, {
      folderId: typeof folderId === "string" && folderId ? folderId : null,
      favorite,
    })
    await this.sync(accountId)
  }

  /** A trashed item Keyward may restore or delete. */
  private async trashedItem(
    vaultId: string,
    itemId: string,
  ): Promise<TrashedItem> {
    const { trashed } = await this.vault(accountIdOfVault(vaultId))
    const item = trashed.find((candidate) => candidate.id === itemId)
    if (!item) throw new VaultError("Not in the trash", "notFound")
    if (!item.editable) throw new VaultError("Read-only item", "notEditable")
    return item
  }

  async restore(vaultId: string, itemId: string): Promise<void> {
    await this.trashedItem(vaultId, itemId)
    const accountId = accountIdOfVault(vaultId)
    const account = await this.account(accountId)
    await new BitwardenApi(
      serverUrls(account.server, account.endpoints),
    ).restoreCipher(await this.accessToken(account), itemId)
    await this.sync(accountId)
  }

  async purge(vaultId: string, itemId: string): Promise<void> {
    await this.trashedItem(vaultId, itemId)
    const accountId = accountIdOfVault(vaultId)
    const account = await this.account(accountId)
    await new BitwardenApi(
      serverUrls(account.server, account.endpoints),
    ).deleteCipher(await this.accessToken(account), itemId)
    await this.sync(accountId)
  }

  async remove(vaultId: string, itemId: string): Promise<void> {
    const accountId = accountIdOfVault(vaultId)
    const account = await this.account(accountId)
    const { item, cipher } = await this.anyItem(vaultId, itemId)
    refuseEdit(item, cipher)
    await new BitwardenApi(
      serverUrls(account.server, account.endpoints),
    ).trashCipher(await this.accessToken(account), itemId)
    await this.sync(accountId)
  }

  private async change(
    vaultId: string,
    cipher: Record<string, unknown>,
    change: ItemChange,
  ): Promise<void> {
    const accountId = accountIdOfVault(vaultId)
    const account = await this.account(accountId)
    const { keys } = await this.vault(accountId)
    await new BitwardenApi(
      serverUrls(account.server, account.endpoints),
    ).updateCipher(
      await this.accessToken(account),
      String(prop(cipher, "Id")),
      await itemUpdateRequest(cipher, change, keys, account.userId),
    )
    await this.sync(accountId)
  }

  canSave(): boolean {
    return true
  }

  async findExisting(
    vaultId: string,
    page: URL,
    username: string,
    password: string,
  ): Promise<ExistingLogin | null> {
    const { vault, items } = await this.matching(
      accountIdOfVault(vaultId),
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

  async folders(vaultId: string): Promise<Folder[]> {
    const { groups } = await this.vault(accountIdOfVault(vaultId))
    return groups.folders
  }

  async save(vaultId: string, login: NewLogin, _tab: TabRef): Promise<void> {
    const accountId = accountIdOfVault(vaultId)
    const account = await this.account(accountId)
    const { keys, groups } = await this.vault(accountId)
    const details = login.details
    const totp = details?.totp.trim() ?? ""
    if (totp) requireCodeKey(totp)
    const folderId = details?.folderId ?? null
    if (folderId && !groups.folders.some((folder) => folder.id === folderId))
      throw new VaultError("Unknown folder", "notFound")
    const api = new BitwardenApi(serverUrls(account.server, account.endpoints))
    await api.createCipher(
      await this.accessToken(account),
      newLoginRequest(
        {
          name: details?.name.trim() || login.url.hostname,
          username: login.username,
          password: login.password,
          uri: login.url.origin,
          notes: details?.notes,
          totp,
          customFields: details?.customFields,
          folderId,
        },
        keys,
        account.userId,
      ),
    )
    await this.sync(accountId)
  }

  async update(
    vaultId: string,
    loginId: string,
    login: NewLogin,
    _tab: TabRef,
  ): Promise<void> {
    const { ciphers } = await this.vault(accountIdOfVault(vaultId))
    const cipher = ciphers.find((c) => prop(c, "Id") === loginId)
    if (!cipher) throw new VaultError("Unknown login", "notFound")
    await this.change(vaultId, cipher, { password: login.password })
  }
}

/**
 * The account's name, or its email address. Two accounts with the same address on different
 * servers are told apart by the server's host.
 */
function accountLabel(
  account: StoredAccount,
  accounts: readonly StoredAccount[],
): string {
  const name = account.name?.trim()
  if (name) return name
  const sharesEmail = accounts.some(
    (other) =>
      other.id !== account.id &&
      other.email.toLowerCase() === account.email.toLowerCase(),
  )
  if (!sharesEmail) return account.email
  return `${account.email} · ${serverHost(account.server)}`
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
      // Left out, as above.
    }
  }
  return decrypted
}

function summaryOf(item: LoginItem): LoginSummary {
  return {
    id: item.id,
    username: item.username,
    title: item.name,
    host:
      item.uris.map((u) => hostOfSavedUri(u.uri)).find((h) => h !== null) ??
      undefined,
    hasCode: item.hasTotp && !item.reprompt,
    grouping: item.grouping,
    favorite: item.favorite,
  }
}

function noteSummaryOf(note: NoteItem): NoteSummary {
  return {
    id: note.id,
    name: note.name,
    grouping: note.grouping,
    favorite: note.favorite,
  }
}

function requireCodeKey(key: string): void {
  try {
    oneTimeCode(key)
  } catch {
    throw new VaultError(
      "The authenticator key cannot be read",
      "invalidCodeKey",
    )
  }
}

/**
 * Items that ask for the master password again stay with Bitwarden's own apps, and an
 * organization's read-only items, marked so by the server, cannot be changed.
 */
/** What editing and re-prompt checks need of a login or a note. */
type RepromptItem = { reprompt: boolean }

function isEditable(
  item: RepromptItem,
  cipher: Record<string, unknown>,
): boolean {
  return !item.reprompt && prop(cipher, "Edit") !== false
}

function refuseEdit(item: RepromptItem, cipher: Record<string, unknown>): void {
  refuseReprompt(item)
  if (!isEditable(item, cipher))
    throw new VaultError("The login cannot be changed", "notEditable")
}

/** What a fill puts into the page for a custom field; a linked field takes its login value. */
function fillFieldOf(
  field: CustomField,
  login: { username: string; password: string },
): FillField {
  switch (field.kind) {
    case "checkbox":
      return { name: field.name, checked: field.checked }
    case "linked":
      return { name: field.name, text: login[field.linkedTo] }
    default:
      return { name: field.name, text: field.value }
  }
}

/** The custom fields a fill can match to page fields: those with a name. */
function fillFields(
  customFields: CustomField[],
  login: { username: string; password: string },
): FillField[] {
  return customFields
    .filter((field) => field.name !== "")
    .map((field) => fillFieldOf(field, login))
}

/** Items marked for master password re-prompt are left to Bitwarden's own apps. */
function refuseReprompt(item: RepromptItem): void {
  if (item.reprompt) {
    throw new VaultError(
      "The login asks for the master password again",
      "bitwarden.reprompt",
    )
  }
}

function pendingView(pending: PendingSignIn): PendingSignInView {
  return {
    server: pending.server,
    endpoints: pending.endpoints,
    email: pending.login.email,
    methods: pending.login.methods,
  }
}

function expiryOf(token: Record<string, unknown>): number {
  const seconds = prop(token, "expires_in")
  return Date.now() + (typeof seconds === "number" ? seconds : 3600) * 1000
}

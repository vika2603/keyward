import { ruleForHost, uriMatches } from "@/lib/matching"
import { getSettings } from "@/lib/settings"
import { oneTimeCode } from "@/lib/totp"
import {
  type CodeSetup,
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
  type TrashedItem,
  type VaultContents,
  VaultError,
  type VaultInfo,
  type VaultProvider,
} from "../types"
import { AccountSessions, apiOf } from "./account-session"
import {
  loadAccounts,
  loadSession,
  loadSyncedAt,
  type StoredAccount,
  updateAccount,
} from "./account-store"
import { type BitwardenApi, valueAt } from "./api"
import { CIPHER_TYPE_LOGIN, CIPHER_TYPE_SECURE_NOTE } from "./cipher-types"
import type { VaultCrypto } from "./crypto"
import {
  decryptDetails,
  decryptLogin,
  decryptNote,
  decryptPassword,
  decryptPasswordHistory,
  decryptTotp,
  firstHostOf,
  type LoginItem,
  matchesQuery,
  type NoteItem,
  textMatchesQuery,
} from "./decrypt"
import type { VaultKeys } from "./keys"
import { grantPass, type RepromptItem, withPass } from "./reprompt-passes"
import {
  type ItemChange,
  itemUpdateRequest,
  newLoginRequest,
  newNoteRequest,
} from "./requests"
import { type CustomEndpoints, serverHost } from "./server"
import {
  type PendingSignInView,
  SignInFlow,
  type SignInOutcome,
} from "./sign-in"
import { type Vault, VaultCache } from "./vault-cache"
import { accountIdOfVault, isBitwardenVault, vaultIdOf } from "./vault-id"

export type { PendingSignInView, SignInOutcome }

export interface AccountSummary {
  id: string
  vaultId: string
  email: string
  server: string
  /** The separate API and identity addresses of a self-hosted server, when it has them. */
  endpoints?: CustomEndpoints
  /** The name the user gave the account; empty when there is none. */
  name: string
  /** What the interface calls the account: its name, else its email address. */
  label: string
  unlocked: boolean
  /** When the account's items were last fetched from its server, while it is unlocked. */
  syncedAt?: number
}

/** What a request that changes the vault gets: the account's API, a fresh token and the account. */
interface WriteAccess {
  api: BitwardenApi
  accessToken: string
  account: StoredAccount
}

/**
 * Accounts of Bitwarden-compatible servers, any number signed in at once. Each account is a vault
 * of its own and is locked or unlocked on its own; unlocking one never locks another.
 */
export class BitwardenProvider implements VaultProvider {
  readonly kind = "bitwarden" as const
  private readonly listeners = new Set<() => void>()
  private readonly sessions: AccountSessions
  private readonly cache: VaultCache
  private readonly signInFlow: SignInFlow

  constructor(loadCrypto: () => Promise<VaultCrypto>) {
    this.sessions = new AccountSessions(loadCrypto, (accountId) =>
      this.cache.forget(accountId),
    )
    this.cache = new VaultCache(this.sessions, loadCrypto, () => this.changed())
    this.signInFlow = new SignInFlow(
      loadCrypto,
      (server, endpoints, signedIn) =>
        this.finishSignIn(server, endpoints, signedIn),
    )
  }

  ownsVault(vaultId: string): boolean {
    return isBitwardenVault(vaultId)
  }

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
        endpoints: account.endpoints,
        name: account.name ?? "",
        label: accountLabel(account, accounts),
        unlocked: (await loadSession(account.id)) !== null,
        syncedAt: (await loadSyncedAt(account.id)) ?? undefined,
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
    const trimmed = name.trim()
    await updateAccount(accountId, (account) => ({ ...account, name: trimmed }))
    this.changed()
  }

  signIn(
    server: string,
    credentials: { email: string; password: string },
    endpoints?: CustomEndpoints,
  ): Promise<SignInOutcome> {
    return this.signInFlow.signIn(server, credentials, endpoints)
  }

  pendingSignIn(): Promise<PendingSignInView | null> {
    return this.signInFlow.pendingSignIn()
  }

  cancelSignIn(): Promise<void> {
    return this.signInFlow.cancelSignIn()
  }

  sendEmailCode(): Promise<void> {
    return this.signInFlow.sendEmailCode()
  }

  submitSecondStep(
    ...step: Parameters<SignInFlow["submitSecondStep"]>
  ): Promise<string> {
    return this.signInFlow.submitSecondStep(...step)
  }

  private async finishSignIn(
    ...signedIn: Parameters<AccountSessions["establish"]>
  ): Promise<string> {
    const accountId = await this.sessions.establish(...signedIn)
    this.changed()
    await this.cache.sync(accountId).catch(() => {})
    return accountId
  }

  /** Unlocks one account with its master password; other accounts keep their state. */
  async unlock(accountId: string, password: string): Promise<void> {
    await this.sessions.unlock(accountId, password)
    this.changed()
    void this.cache.sync(accountId).catch(() => {})
  }

  async lock(vaultId: string): Promise<void> {
    await this.sessions.lock(accountIdOfVault(vaultId))
    this.changed()
  }

  async lockAll(): Promise<void> {
    for (const account of await loadAccounts()) {
      await this.sessions.lock(account.id)
      this.changed()
    }
  }

  async signOut(accountId: string): Promise<void> {
    await this.sessions.signOut(accountId)
    this.changed()
  }

  /** Locks accounts that have not been used for `minutes`. */
  async lockIdle(minutes: number): Promise<void> {
    for (const accountId of await this.sessions.idleAccounts(minutes)) {
      await this.sessions.lock(accountId)
      this.changed()
    }
  }

  sync(accountId: string): Promise<void> {
    return this.cache.sync(accountId)
  }

  private vaultOf(vaultId: string, passive = false): Promise<Vault> {
    return this.cache.vault(accountIdOfVault(vaultId), passive)
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
    const { items, notes, trashed } = await this.vaultOf(vaultId)
    if (![...items, ...notes, ...trashed].some((item) => item.id === itemId))
      throw new VaultError("Unknown item", "notFound")
    await this.sessions.verifyMasterPassword(
      await this.sessions.account(accountId),
      password,
    )
    // Deriving the key takes a moment; a lock in that time must not be followed by a pass.
    await this.sessions.unlockedSession(accountId)
    await grantPass(vaultId, itemId)
  }

  /** Runs a request that changes the vault, then syncs so lists show the change. */
  private async write(
    vaultId: string,
    send: (access: WriteAccess) => Promise<unknown>,
  ): Promise<void> {
    const accountId = accountIdOfVault(vaultId)
    const account = await this.sessions.account(accountId)
    await send({
      api: apiOf(account),
      accessToken: await this.sessions.accessToken(account),
      account,
    })
    await this.cache.sync(accountId)
  }

  /** The vault's logins for the page, by their saved addresses and the site's match rule. */
  private async matching(
    vaultId: string,
    page: URL,
    passive = false,
  ): Promise<{ vault: Vault; items: LoginItem[] }> {
    const vault = await this.vaultOf(vaultId, passive)
    const settings = await getSettings()
    const rule = ruleForHost(settings.siteRules, page.hostname)
    const options = {
      defaultMatch: settings.defaultMatch,
      equivalentDomains: settings.equivalentDomains,
    }
    const items = vault.items.filter((item) =>
      item.uris.some(({ uri, match }) =>
        uriMatches(uri, match ?? rule?.match ?? null, page, options),
      ),
    )
    return { vault, items }
  }

  async logins(
    vaultId: string,
    page: URL,
    options?: ListOptions,
  ): Promise<LoginSummary[]> {
    const { items } = await this.matching(vaultId, page, options?.passive)
    return items.map(summaryOf)
  }

  async search(vaultId: string, query: string): Promise<LoginSummary[]> {
    const { items } = await this.vaultOf(vaultId)
    return items
      .filter((item) => matchesQuery(item, query))
      .sort((first, second) => first.name.localeCompare(second.name))
      .map(summaryOf)
  }

  /** Every login and note of the account, as the popup lists them when browsing the vault. */
  async allItems(vaultId: string): Promise<VaultContents> {
    const { items, notes, groups, trashed } = await this.vaultOf(vaultId)
    return {
      logins: items.map(summaryOf),
      notes: notes.map(noteSummaryOf),
      groups,
      trashed,
    }
  }

  async searchNotes(vaultId: string, query: string): Promise<NoteSummary[]> {
    const { notes } = await this.vaultOf(vaultId)
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
    const vault = await this.vaultOf(vaultId)
    const cipher =
      vault.noteCiphers.find(
        (candidate) => valueAt(candidate, "Id") === noteId,
      ) ??
      vault.trashedCiphers.find(
        (candidate) =>
          valueAt(candidate, "Id") === noteId &&
          valueAt(candidate, "Type") === CIPHER_TYPE_SECURE_NOTE,
      )
    const note =
      vault.notes.find((candidate) => candidate.id === noteId) ??
      (cipher ? decryptNote(cipher, vault.keys) : undefined)
    if (!note || !cipher) throw new VaultError("Unknown note", "notFound")
    return { vault, note: await withPass(vaultId, note), cipher }
  }

  /** The login or note an item ID names. */
  private async anyItem(
    vaultId: string,
    itemId: string,
  ): Promise<{ item: RepromptItem; cipher: Record<string, unknown> }> {
    const { notes, trashedCiphers } = await this.vaultOf(vaultId)
    const isNote =
      notes.some((candidate) => candidate.id === itemId) ||
      trashedCiphers.some(
        (candidate) =>
          valueAt(candidate, "Id") === itemId &&
          valueAt(candidate, "Type") === CIPHER_TYPE_SECURE_NOTE,
      )
    if (!isNote) return this.pageItem(vaultId, itemId, null)
    const { note, cipher } = await this.noteEntry(vaultId, itemId)
    return { item: note, cipher }
  }

  async note(vaultId: string, noteId: string): Promise<NoteDetails> {
    const { vault, note, cipher } = await this.noteEntry(vaultId, noteId)
    const details = decryptDetails(cipher, vault.keys)
    const trashed = Boolean(valueAt(cipher, "DeletedDate"))
    return {
      name: note.name,
      // Like a login's secrets, a re-prompted note's contents stay in Bitwarden's own apps.
      text: note.reprompt ? undefined : details.notes,
      customFields: note.reprompt ? undefined : details.customFields,
      withheld: note.reprompt,
      editable: isEditable(note, cipher),
      favorite: trashed ? undefined : note.favorite,
      created: details.created,
      modified: details.modified,
    }
  }

  async editableNote(vaultId: string, noteId: string): Promise<EditableNote> {
    const { vault, note, cipher } = await this.noteEntry(vaultId, noteId)
    refuseEdit(note, cipher)
    return editableNoteOf(vault.keys, note, cipher)
  }

  async saveNote(vaultId: string, note: EditableNote): Promise<void> {
    const { keys } = await this.vaultOf(vaultId)
    await this.write(vaultId, ({ api, accessToken, account }) =>
      api.createCipher(accessToken, newNoteRequest(note, keys, account.userId)),
    )
  }

  /** Saves the parts of the note that differ from what is saved. */
  async editNote(
    vaultId: string,
    noteId: string,
    next: EditableNote,
  ): Promise<void> {
    const { vault, note, cipher } = await this.noteEntry(vaultId, noteId)
    refuseEdit(note, cipher)
    const current = editableNoteOf(vault.keys, note, cipher)
    const changed: ItemChange = {}
    if (next.name !== current.name) changed.name = next.name
    if (next.text !== current.text) changed.notes = next.text
    if (!sameValues(next.customFields, current.customFields))
      changed.customFields = next.customFields
    await this.change(vaultId, vault.keys, cipher, changed)
  }

  /**
   * A login with its encrypted item. With a page, only an active login of that page is found;
   * without one, any login of the vault (trashed ones included), for Keyward's own views.
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
    if (page) {
      const { vault, items } = await this.matching(vaultId, page)
      const item = items.find((candidate) => candidate.id === loginId)
      const cipher = vault.ciphers.find(
        (candidate) => valueAt(candidate, "Id") === loginId,
      )
      if (!item || !cipher)
        throw new VaultError("The login does not match this page", "notFound")
      return { vault, item: await withPass(vaultId, item), cipher }
    }
    const vault = await this.vaultOf(vaultId)
    const cipher =
      vault.ciphers.find((candidate) => valueAt(candidate, "Id") === loginId) ??
      vault.trashedCiphers.find(
        (candidate) =>
          valueAt(candidate, "Id") === loginId &&
          valueAt(candidate, "Type") === CIPHER_TYPE_LOGIN,
      )
    const item =
      vault.items.find((candidate) => candidate.id === loginId) ??
      (cipher ? decryptLogin(cipher, vault.keys) : undefined)
    if (!item || !cipher)
      throw new VaultError("The login does not match this page", "notFound")
    return { vault, item: await withPass(vaultId, item), cipher }
  }

  async credential(
    vaultId: string,
    loginId: string,
    page: URL | null,
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
      uris: item.uris.map(({ uri }) => uri).filter((uri) => uri !== ""),
      // Notes, fields and earlier passwords may hold secrets too, so a re-prompted item keeps them back.
      notes: item.reprompt ? undefined : details.notes || undefined,
      customFields: item.reprompt ? undefined : details.customFields,
      pastPasswordCount: item.reprompt ? undefined : details.pastPasswordCount,
      hasCode: item.hasTotp,
      secretsWithheld: item.reprompt,
      editable: isEditable(item, cipher),
      favorite: valueAt(cipher, "DeletedDate") ? undefined : item.favorite,
      created: details.created,
      modified: details.modified,
      passwordModified: details.passwordModified,
      hasPasskey: details.hasPasskey,
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
    return (await this.logins(vaultId, page)).filter((login) => login.hasCode)
  }

  async oneTimeCode(
    vaultId: string,
    loginId: string,
    page: URL | null,
  ): Promise<OneTimeCode> {
    const { vault, item, cipher } = await this.pageItem(vaultId, loginId, page)
    refuseReprompt(item)
    const key = item.hasTotp ? decryptTotp(cipher, vault.keys) : ""
    if (!key)
      throw new VaultError("The login has no authenticator key", "noCode")
    try {
      return oneTimeCode(key)
    } catch {
      throw unreadableCodeKey()
    }
  }

  /** Every account takes an authenticator key into a login the user picks. */
  codeSetup(): CodeSetup {
    return "login"
  }

  /** Stores an authenticator key in a login of the page, replacing the one it has. */
  async setUpCode(
    vaultId: string,
    loginId: string | null,
    page: URL,
    key: string,
  ): Promise<void> {
    if (!loginId) throw new VaultError("No login was chosen", "invalidInput")
    requireCodeKey(key)
    const { vault, item, cipher } = await this.pageItem(vaultId, loginId, page)
    refuseReprompt(item)
    await this.change(vaultId, vault.keys, cipher, { totp: key })
  }

  async editable(vaultId: string, loginId: string): Promise<EditableLogin> {
    const { vault, item, cipher } = await this.pageItem(vaultId, loginId, null)
    refuseEdit(item, cipher)
    return editableLoginOf(vault.keys, item, cipher)
  }

  /** Saves the fields that differ from the item's; an unchanged password stays out of the history. */
  async edit(
    vaultId: string,
    loginId: string,
    change: LoginEdit,
  ): Promise<void> {
    const { vault, item, cipher } = await this.pageItem(vaultId, loginId, null)
    refuseEdit(item, cipher)
    const changed = loginChanges(
      editableLoginOf(vault.keys, item, cipher),
      change,
    )
    await this.change(vaultId, vault.keys, cipher, changed)
  }

  async setFavorite(
    vaultId: string,
    itemId: string,
    favorite: boolean,
  ): Promise<void> {
    const { cipher } = await this.anyItem(vaultId, itemId)
    if (valueAt(cipher, "DeletedDate"))
      throw new VaultError("The item is in the trash", "notEditable")
    // The request sets the folder as well, so the item's own goes with it.
    const folderId = valueAt(cipher, "FolderId")
    await this.write(vaultId, ({ api, accessToken }) =>
      api.updateCipherPartial(accessToken, itemId, {
        folderId: typeof folderId === "string" && folderId ? folderId : null,
        favorite,
      }),
    )
  }

  /** A trashed item Keyward may restore or delete. */
  private async trashedItem(
    vaultId: string,
    itemId: string,
  ): Promise<TrashedItem> {
    const { trashed } = await this.vaultOf(vaultId)
    const item = trashed.find((candidate) => candidate.id === itemId)
    if (!item) throw new VaultError("Not in the trash", "notFound")
    if (!item.editable) throw new VaultError("Read-only item", "notEditable")
    return item
  }

  async restore(vaultId: string, itemId: string): Promise<void> {
    await this.trashedItem(vaultId, itemId)
    await this.write(vaultId, ({ api, accessToken }) =>
      api.restoreCipher(accessToken, itemId),
    )
  }

  async purge(vaultId: string, itemId: string): Promise<void> {
    await this.trashedItem(vaultId, itemId)
    await this.write(vaultId, ({ api, accessToken }) =>
      api.deleteCipher(accessToken, itemId),
    )
  }

  async remove(vaultId: string, itemId: string): Promise<void> {
    const { item, cipher } = await this.anyItem(vaultId, itemId)
    refuseEdit(item, cipher)
    await this.write(vaultId, ({ api, accessToken }) =>
      api.trashCipher(accessToken, itemId),
    )
  }

  /** Sends a change of an item; a change without fields sends nothing. */
  private async change(
    vaultId: string,
    keys: VaultKeys,
    cipher: Record<string, unknown>,
    change: ItemChange,
  ): Promise<void> {
    if (!Object.keys(change).length) return
    await this.write(vaultId, async ({ api, accessToken, account }) =>
      api.updateCipher(
        accessToken,
        String(valueAt(cipher, "Id")),
        await itemUpdateRequest(cipher, change, keys, account.userId),
      ),
    )
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
    const { vault, items } = await this.matching(vaultId, page)
    const found = items.find((candidate) => candidate.username === username)
    if (!found) return null
    const item = await withPass(vaultId, found)
    const cipher = vault.ciphers.find(
      (saved) => valueAt(saved, "Id") === item.id,
    )
    const savedPassword = cipher
      ? decryptPassword(cipher, vault.keys)
      : undefined
    return {
      loginId: item.id,
      samePassword:
        savedPassword === undefined ? undefined : savedPassword === password,
      editable: cipher !== undefined && isEditable(item, cipher),
    }
  }

  async folders(vaultId: string): Promise<Folder[]> {
    const { groups } = await this.vaultOf(vaultId)
    return groups.folders
  }

  async save(vaultId: string, login: NewLogin): Promise<void> {
    const { keys, groups } = await this.vaultOf(vaultId)
    const details = login.details
    const totp = details?.totp.trim() ?? ""
    if (totp) requireCodeKey(totp)
    const folderId = details?.folderId ?? null
    if (folderId && !groups.folders.some((folder) => folder.id === folderId))
      throw new VaultError("Unknown folder", "notFound")
    await this.write(vaultId, ({ api, accessToken, account }) =>
      api.createCipher(
        accessToken,
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
      ),
    )
  }

  async update(
    vaultId: string,
    loginId: string,
    login: NewLogin,
  ): Promise<void> {
    const { vault, item, cipher } = await this.pageItem(vaultId, loginId, null)
    refuseEdit(item, cipher)
    await this.change(vaultId, vault.keys, cipher, {
      password: login.password,
    })
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

function summaryOf(item: LoginItem): LoginSummary {
  return {
    id: item.id,
    username: item.username,
    title: item.name,
    host: firstHostOf(item),
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

function editableLoginOf(
  keys: VaultKeys,
  item: LoginItem,
  cipher: Record<string, unknown>,
): EditableLogin {
  const { notes, customFields } = decryptDetails(cipher, keys)
  return {
    name: item.name,
    username: item.username,
    password: decryptPassword(cipher, keys),
    uris: item.uris
      .filter((website) => website.uri !== "")
      .map(({ uri, match }) => ({ uri, match })),
    notes,
    totp: item.hasTotp ? decryptTotp(cipher, keys) : "",
    customFields,
  }
}

function editableNoteOf(
  keys: VaultKeys,
  note: NoteItem,
  cipher: Record<string, unknown>,
): EditableNote {
  const { notes, customFields } = decryptDetails(cipher, keys)
  return { name: note.name, text: notes, customFields }
}

/** Whether two lists of custom fields or websites hold the same values in the same order. */
function sameValues(first: unknown, second: unknown): boolean {
  return JSON.stringify(first) === JSON.stringify(second)
}

/** The fields of an edit that differ from the login as it is saved. */
function loginChanges(current: EditableLogin, change: LoginEdit): ItemChange {
  const changed: ItemChange = {}
  for (const key of ["name", "username", "password", "notes"] as const) {
    const value = change[key]
    if (value !== undefined && value !== current[key]) changed[key] = value
  }
  const totp = change.totp?.trim()
  if (totp !== undefined && totp !== current.totp) {
    if (totp) requireCodeKey(totp)
    changed.totp = totp
  }
  const uris = change.uris
    ?.map((website) => ({ ...website, uri: website.uri.trim() }))
    .filter((website) => website.uri !== "")
  if (uris !== undefined && !sameValues(uris, current.uris)) changed.uris = uris
  if (
    change.customFields !== undefined &&
    !sameValues(change.customFields, current.customFields)
  )
    changed.customFields = change.customFields
  return changed
}

function unreadableCodeKey(): VaultError {
  return new VaultError(
    "The authenticator key cannot be read",
    "invalidCodeKey",
  )
}

function requireCodeKey(key: string): void {
  try {
    oneTimeCode(key)
  } catch {
    throw unreadableCodeKey()
  }
}

/**
 * Items that ask for the master password again stay with Bitwarden's own apps, and an
 * organization's read-only items, marked so by the server, cannot be changed.
 */
function isEditable(
  item: Pick<RepromptItem, "reprompt">,
  cipher: Record<string, unknown>,
): boolean {
  return (
    !item.reprompt &&
    !valueAt(cipher, "DeletedDate") &&
    valueAt(cipher, "Edit") !== false
  )
}

function refuseEdit(
  item: Pick<RepromptItem, "reprompt">,
  cipher: Record<string, unknown>,
): void {
  refuseReprompt(item)
  if (!isEditable(item, cipher))
    throw new VaultError("The login cannot be changed", "notEditable")
}

/** Items marked for master password re-prompt are left to Bitwarden's own apps. */
function refuseReprompt(item: Pick<RepromptItem, "reprompt">): void {
  if (item.reprompt) {
    throw new VaultError(
      "The login asks for the master password again",
      "bitwarden.reprompt",
    )
  }
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

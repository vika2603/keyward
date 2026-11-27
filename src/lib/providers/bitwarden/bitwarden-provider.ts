import { ruleForHost, uriMatches } from "@/lib/matching"
import type {
  PasskeyCreateRequest,
  PasskeyDescriptor,
  PasskeyGetRequest,
  PasskeyOption,
  SerializedCreateResult,
  SerializedGetResult,
} from "@/lib/passkeys/types"
import {
  assertPasskeyCredential,
  createPasskeyCredential,
  credentialIdBase64Url,
} from "@/lib/passkeys/webauthn"
import { getSettings } from "@/lib/settings"
import { hostOfSavedUri, siteDomainOf } from "@/lib/site"
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
  type VaultGroups,
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
import {
  ciphersById,
  runSecurityAudit,
  type SecurityAuditFinding,
  type SecurityAuditReport,
} from "./audit"
import {
  CIPHER_TYPE_LOGIN,
  CIPHER_TYPE_SECURE_NOTE,
  REPROMPT_PASSWORD,
} from "./cipher-types"
import type { VaultCrypto } from "./crypto"
import {
  decryptDetails,
  decryptFido2Credentials,
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
import { collectVaultPasskeys, hasExcludedPasskey } from "./passkeys"

export type { SecurityAuditFinding, SecurityAuditReport }

import type { VaultKeys } from "./keys"
import { grantPass, type RepromptItem, withPass } from "./reprompt-passes"
import {
  cloneCipherRequest,
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

  /** Refreshes every unlocked account, throwing the first failure if any account fails to sync. */
  async syncAll(): Promise<void> {
    const accounts = await loadAccounts()
    let firstError: unknown = null
    for (const account of accounts) {
      if (!(await loadSession(account.id))) continue
      try {
        await this.cache.sync(account.id)
      } catch (error) {
        firstError ??= error
      }
    }
    if (firstError) throw firstError
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
      equivalentDomains: [
        ...settings.equivalentDomains,
        ...vault.equivalentDomains,
      ],
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
    const { items, groups } = await this.vaultOf(vaultId)
    const folderNames = new Map(
      groups.folders.map((folder) => [folder.id, folder.name]),
    )
    return items
      .filter((item) =>
        matchesQuery(
          item,
          query,
          item.grouping.folderId
            ? (folderNames.get(item.grouping.folderId) ?? "")
            : "",
        ),
      )
      .sort((first, second) => first.name.localeCompare(second.name))
      .map(summaryOf)
  }

  /** Every login and note of the account, as the popup lists them when browsing the vault. */
  async allItems(vaultId: string): Promise<VaultContents> {
    const { items, notes, groups, trashed, archived } =
      await this.vaultOf(vaultId)
    return {
      logins: items.map(summaryOf),
      notes: notes.map(noteSummaryOf),
      groups,
      trashed,
      archived,
    }
  }

  async searchNotes(vaultId: string, query: string): Promise<NoteSummary[]> {
    const { notes, groups } = await this.vaultOf(vaultId)
    const folderNames = new Map(
      groups.folders.map((folder) => [folder.id, folder.name]),
    )
    return notes
      .filter((note) => {
        const folderName = note.grouping.folderId
          ? (folderNames.get(note.grouping.folderId) ?? "")
          : ""
        return textMatchesQuery(
          [note.name, folderName, note.searchableText].join("\n"),
          query,
        )
      })
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
      ) ??
      vault.archivedCiphers.find(
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
  ): Promise<{
    vault: Vault
    item: RepromptItem
    cipher: Record<string, unknown>
  }> {
    const { notes, trashedCiphers, archivedCiphers } =
      await this.vaultOf(vaultId)
    const isNote =
      notes.some((candidate) => candidate.id === itemId) ||
      trashedCiphers.some(
        (candidate) =>
          valueAt(candidate, "Id") === itemId &&
          valueAt(candidate, "Type") === CIPHER_TYPE_SECURE_NOTE,
      ) ||
      archivedCiphers.some(
        (candidate) =>
          valueAt(candidate, "Id") === itemId &&
          valueAt(candidate, "Type") === CIPHER_TYPE_SECURE_NOTE,
      )
    if (!isNote) return this.pageItem(vaultId, itemId, null)
    const { vault, note, cipher } = await this.noteEntry(vaultId, itemId)
    return { vault, item: note, cipher }
  }

  async note(vaultId: string, noteId: string): Promise<NoteDetails> {
    const { vault, note, cipher } = await this.noteEntry(vaultId, noteId)
    const details = decryptDetails(cipher, vault.keys)
    const inactive =
      Boolean(valueAt(cipher, "DeletedDate")) ||
      Boolean(valueAt(cipher, "ArchivedDate"))
    return {
      name: note.name,
      // Like a login's secrets, a re-prompted note's contents stay in Bitwarden's own apps.
      text: note.reprompt ? undefined : details.notes,
      customFields: note.reprompt ? undefined : details.customFields,
      withheld: note.reprompt,
      editable: isEditable(note, cipher),
      favorite: inactive ? undefined : note.favorite,
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
    const { keys, groups } = await this.vaultOf(vaultId)
    const folderId = requireFolder(groups, note.folderId ?? null)
    const organizationId = note.organizationId ?? null
    const collectionIds = organizationId
      ? checkedCollections(groups, organizationId, note.collectionIds ?? [])
      : []
    await this.write(vaultId, ({ api, accessToken, account }) =>
      createOwnedCipher(
        api,
        accessToken,
        newNoteRequest(
          { ...note, folderId, organizationId },
          keys,
          account.userId,
        ),
        organizationId,
        collectionIds,
      ),
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
    if (next.folderId !== undefined && next.folderId !== current.folderId) {
      changed.folderId = requireFolder(vault.groups, next.folderId)
    }
    if (next.reprompt !== undefined && next.reprompt !== current.reprompt)
      changed.reprompt = next.reprompt
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
      ) ??
      vault.archivedCiphers.find(
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
    const hasHttpsUri =
      page !== null &&
      item.uris.some(({ uri }) => {
        const trimmed = uri.trim()
        if (!/^https:\/\//i.test(trimmed)) return false
        const savedHost = hostOfSavedUri(trimmed)
        return (
          savedHost !== null &&
          siteDomainOf(savedHost) === siteDomainOf(page.hostname)
        )
      })
    return {
      username: item.username,
      password,
      fields: fillFields(customFields, { username: item.username, password }),
      ...(hasHttpsUri ? { hasHttpsUri: true } : {}),
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
    if (change.folderId !== undefined)
      requireFolder(vault.groups, change.folderId)
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

  async groups(vaultId: string): Promise<VaultGroups> {
    const { groups } = await this.vaultOf(vaultId)
    return groups
  }

  async createFolder(vaultId: string, name: string): Promise<Folder> {
    const trimmed = name.trim()
    if (!trimmed)
      throw new VaultError("Folder name cannot be empty", "invalidInput")
    const { keys } = await this.vaultOf(vaultId)
    const encrypted = keys.encrypt(trimmed, keys.userKey)
    if (!encrypted)
      throw new VaultError("Folder name cannot be empty", "invalidInput")
    let createdId = ""
    await this.write(vaultId, async ({ api, accessToken }) => {
      const response = await api.createFolder(accessToken, encrypted)
      createdId = String(valueAt(response, "Id") ?? "")
    })
    return { id: createdId, name: trimmed }
  }

  async renameFolder(
    vaultId: string,
    folderId: string,
    name: string,
  ): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed)
      throw new VaultError("Folder name cannot be empty", "invalidInput")
    const { keys, groups } = await this.vaultOf(vaultId)
    requireFolder(groups, folderId)
    const encrypted = keys.encrypt(trimmed, keys.userKey)
    if (!encrypted)
      throw new VaultError("Folder name cannot be empty", "invalidInput")
    await this.write(vaultId, ({ api, accessToken }) =>
      api.updateFolder(accessToken, folderId, encrypted),
    )
  }

  async deleteFolder(vaultId: string, folderId: string): Promise<void> {
    const { groups } = await this.vaultOf(vaultId)
    requireFolder(groups, folderId)
    await this.write(vaultId, ({ api, accessToken }) =>
      api.deleteFolder(accessToken, folderId),
    )
  }

  async clone(vaultId: string, itemId: string): Promise<void> {
    const { vault, item, cipher } = await this.anyItem(vaultId, itemId)
    refuseEdit(item, cipher)
    const originalName = vault.keys.decrypt(
      valueAt(cipher, "Name"),
      vault.keys.forCipher(cipher),
    )
    const cloneName = `${originalName} - Clone`
    const organizationId = valueAt(cipher, "OrganizationId")
    const ownerOrgId =
      typeof organizationId === "string" && organizationId
        ? organizationId
        : null
    const collectionIds = ownerOrgId
      ? ((valueAt(cipher, "CollectionIds") as string[] | undefined) ?? [])
      : []
    await this.write(vaultId, ({ api, accessToken, account }) =>
      createOwnedCipher(
        api,
        accessToken,
        cloneCipherRequest(cipher, vault.keys, account.userId, cloneName),
        ownerOrgId,
        collectionIds,
      ),
    )
  }

  async archive(vaultId: string, itemId: string): Promise<void> {
    const { item, cipher } = await this.anyItem(vaultId, itemId)
    refuseEdit(item, cipher)
    await this.write(vaultId, ({ api, accessToken }) =>
      api.archiveCipher(accessToken, itemId),
    )
  }

  async unarchive(vaultId: string, itemId: string): Promise<void> {
    const { archived } = await this.vaultOf(vaultId)
    const item = archived.find((candidate) => candidate.id === itemId)
    if (!item) throw new VaultError("Not in the archive", "notFound")
    if (!item.editable) throw new VaultError("Read-only item", "notEditable")
    await this.write(vaultId, ({ api, accessToken }) =>
      api.unarchiveCipher(accessToken, itemId),
    )
  }

  async save(vaultId: string, login: NewLogin): Promise<void> {
    const { keys, groups } = await this.vaultOf(vaultId)
    const details = login.details
    const totp = details?.totp.trim() ?? ""
    if (totp) requireCodeKey(totp)
    const folderId = requireFolder(groups, details?.folderId ?? null)
    const organizationId = details?.organizationId ?? null
    const collectionIds = organizationId
      ? checkedCollections(groups, organizationId, details?.collectionIds ?? [])
      : []
    await this.write(vaultId, ({ api, accessToken, account }) =>
      createOwnedCipher(
        api,
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
            reprompt: details?.reprompt,
            organizationId,
          },
          keys,
          account.userId,
        ),
        organizationId,
        collectionIds,
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
    const changes: ItemChange = { password: login.password }
    if (login.username && login.username !== item.username)
      changes.username = login.username
    await this.change(vaultId, vault.keys, cipher, changes)
  }

  /**
   * Audits all unlocked Bitwarden vaults locally for weak, reused, and HTTP-only login passwords.
   * Performs no network requests and skips reprompt-protected items.
   */
  async securityAudit(): Promise<SecurityAuditReport> {
    const allVaults = await this.vaults()
    const ready = await Promise.all(
      allVaults
        .filter((vault) => vault.status === "ready")
        .map(async (info) => ({ info, vault: await this.vaultOf(info.id) })),
    )
    return runSecurityAudit(ready, summaryOf)
  }

  /** Whether at least one Bitwarden account is configured (unlocked or locked). */
  async hasConfiguredAccounts(): Promise<boolean> {
    return (await loadAccounts()).length > 0
  }

  /**
   * Lists Bitwarden passkeys matching `rpId` (and optional `allowCredentials`) across all unlocked
   * vaults, alongside any locked Bitwarden vaults the user could unlock.
   */
  async passkeysForRp(
    rpId: string,
    allowCredentials: readonly PasskeyDescriptor[] = [],
  ): Promise<{ passkeys: PasskeyOption[]; lockedVaults: VaultInfo[] }> {
    const allowSet =
      allowCredentials.length > 0
        ? new Set(allowCredentials.map((cred) => cred.id))
        : null
    const allVaults = await this.vaults()
    const passkeys: PasskeyOption[] = []
    const lockedVaults: VaultInfo[] = []

    for (const vaultInfo of allVaults) {
      if (vaultInfo.status === "locked") {
        lockedVaults.push(vaultInfo)
        continue
      }
      if (vaultInfo.status !== "ready") continue
      const vault = await this.vaultOf(vaultInfo.id)
      passkeys.push(...collectVaultPasskeys(vaultInfo, vault, rpId, allowSet))
    }

    passkeys.sort((a, b) => b.creationDate.localeCompare(a.creationDate))
    return { passkeys, lockedVaults }
  }

  /** Unlocked Bitwarden vaults (with matching editable logins) and locked vaults for saving a new passkey. */
  async passkeySaveTargets(page: URL): Promise<{
    saveTargets: {
      vault: VaultInfo
      existingLogins: { id: string; title: string; username: string }[]
    }[]
    lockedVaults: VaultInfo[]
  }> {
    const allVaults = await this.vaults()
    const saveTargets: {
      vault: VaultInfo
      existingLogins: { id: string; title: string; username: string }[]
    }[] = []
    const lockedVaults: VaultInfo[] = []

    for (const vaultInfo of allVaults) {
      if (vaultInfo.status === "locked") {
        lockedVaults.push(vaultInfo)
        continue
      }
      if (vaultInfo.status !== "ready") continue
      const { vault, items } = await this.matching(vaultInfo.id, page)
      const cipherById = ciphersById(vault.ciphers)
      const existingLogins = items
        .filter((item) => {
          const cipher = cipherById.get(item.id)
          return cipher !== undefined && isEditable(item, cipher)
        })
        .map((item) => ({
          id: item.id,
          title: item.name,
          username: item.username,
        }))
      saveTargets.push({ vault: vaultInfo, existingLogins })
    }
    return { saveTargets, lockedVaults }
  }

  /** Signs a WebAuthn assertion with the chosen Bitwarden passkey. */
  async signPasskey(
    vaultId: string,
    loginId: string,
    credentialId: string,
    request: PasskeyGetRequest,
  ): Promise<SerializedGetResult> {
    const { vault, item, cipher } = await this.pageItem(vaultId, loginId, null)
    refuseReprompt(item)
    const creds = decryptFido2Credentials(cipher, vault.keys)
    const target = creds.find(
      (cred) =>
        cred.credentialId === credentialId ||
        credentialIdBase64Url(cred.credentialId) === credentialId,
    )
    if (!target) throw new VaultError("Passkey not found", "notFound")
    const { credential, nextCounter } = await assertPasskeyCredential(
      target,
      request,
    )
    if (nextCounter > 0 && isEditable(item, cipher)) {
      const updated = creds.map((cred) =>
        cred === target ? { ...cred, counter: String(nextCounter) } : cred,
      )
      await this.change(vaultId, vault.keys, cipher, {
        fido2Credentials: updated,
      }).catch(() => {})
    }
    return credential
  }

  /** Creates a new ECDSA P-256 passkey and saves it to a new or existing Bitwarden login. */
  async createPasskey(
    vaultId: string,
    loginId: string | null,
    request: PasskeyCreateRequest,
  ): Promise<SerializedCreateResult> {
    const vault = await this.vaultOf(vaultId)
    if (hasExcludedPasskey(vault, request.rpId, request.excludeCredentials)) {
      throw new VaultError(
        "A passkey for this account already exists in this vault",
        "invalidInput",
      )
    }

    const { stored, credential } = await createPasskeyCredential(request)

    if (loginId) {
      const { item, cipher } = await this.pageItem(vaultId, loginId, null)
      refuseEdit(item, cipher)
      const existing = decryptFido2Credentials(cipher, vault.keys)
      await this.change(vaultId, vault.keys, cipher, {
        fido2Credentials: [...existing, stored],
      })
    } else {
      await this.write(vaultId, ({ api, accessToken, account }) =>
        api.createCipher(
          accessToken,
          newLoginRequest(
            {
              name: request.rpName || request.rpId,
              username: request.userName || request.userDisplayName,
              password: "",
              uri: request.origin,
              fido2Credentials: [stored],
            },
            vault.keys,
            account.userId,
          ),
        ),
      )
    }

    return credential
  }
}

function requireFolder(
  groups: VaultGroups,
  folderId: string | null,
): string | null {
  if (folderId && !groups.folders.some((folder) => folder.id === folderId))
    throw new VaultError("Unknown folder", "notFound")
  return folderId
}

function createOwnedCipher(
  api: BitwardenApi,
  accessToken: string,
  body: Record<string, unknown>,
  organizationId: string | null,
  collectionIds: readonly string[],
): Promise<unknown> {
  return organizationId
    ? api.createOrganizationCipher(accessToken, body, [...collectionIds])
    : api.createCipher(accessToken, body)
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
    folderId: item.grouping.folderId,
    reprompt: valueAt(cipher, "Reprompt") === REPROMPT_PASSWORD,
  }
}

function editableNoteOf(
  keys: VaultKeys,
  note: NoteItem,
  cipher: Record<string, unknown>,
): EditableNote {
  const { notes, customFields } = decryptDetails(cipher, keys)
  return {
    name: note.name,
    text: notes,
    customFields,
    folderId: note.grouping.folderId,
    reprompt: valueAt(cipher, "Reprompt") === REPROMPT_PASSWORD,
  }
}

function checkedCollections(
  groups: VaultGroups,
  organizationId: string,
  collectionIds: readonly string[],
): string[] {
  if (!groups.organizations.some((org) => org.id === organizationId))
    throw new VaultError("Unknown organization", "notFound")
  const valid = new Set(
    groups.collections
      .filter((collection) => collection.organizationId === organizationId)
      .map((collection) => collection.id),
  )
  const chosen = [...new Set(collectionIds)].filter((id) => valid.has(id))
  if (!chosen.length)
    throw new VaultError("Select at least one collection", "invalidInput")
  return chosen
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
  if (change.folderId !== undefined && change.folderId !== current.folderId)
    changed.folderId = change.folderId
  if (change.reprompt !== undefined && change.reprompt !== current.reprompt)
    changed.reprompt = change.reprompt
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

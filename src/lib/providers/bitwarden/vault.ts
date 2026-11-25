import type {
  CustomField,
  EditableNote,
  ItemGrouping,
  PastPassword,
  TrashedItem,
  VaultGroups,
  Website,
} from "@/lib/providers/types"
import { MatchType } from "@/lib/settings"
import { hostOfSavedUri } from "@/lib/site"
import { pick, prop } from "./api"
import type { VaultCrypto } from "./crypto"

const CIPHER_TYPE_LOGIN = 1
const CIPHER_TYPE_SECURE_NOTE = 2

export interface LoginItem {
  id: string
  organizationId: string | null
  grouping: ItemGrouping
  favorite: boolean
  name: string
  username: string
  uris: { uri: string; match: MatchType | null }[]
  /** Whether the item keeps an authenticator key; the key itself stays encrypted. */
  hasTotp: boolean
  /** Whether the item asks for the master password before its secrets are shown. */
  reprompt: boolean
}

/** The keys an account needs to read its items: its own key and the keys of its organizations. */
export class VaultKeys {
  private constructor(
    private readonly crypto: VaultCrypto,
    readonly userKey: Uint8Array,
    private readonly orgKeys: Map<string, Uint8Array>,
  ) {}

  static fromProfile(
    crypto: VaultCrypto,
    userKey: Uint8Array,
    profile: unknown,
  ): VaultKeys {
    const orgKeys = new Map<string, Uint8Array>()
    const organizations = prop(profile, "Organizations")
    const wrappedPrivateKey =
      prop(
        pick(pick(profile, "AccountKeys"), "PublicKeyEncryptionKeyPair"),
        "WrappedPrivateKey",
      ) ?? prop(profile, "PrivateKey")
    if (
      typeof wrappedPrivateKey === "string" &&
      Array.isArray(organizations) &&
      organizations.length
    ) {
      const privateKey = crypto.unwrapPrivateKey(wrappedPrivateKey, userKey)
      for (const org of organizations) {
        const id = prop(org, "Id")
        const key = prop(org, "Key")
        if (typeof id !== "string" || typeof key !== "string") continue
        try {
          orgKeys.set(id, crypto.decapsulateKey(key, privateKey))
        } catch {
          // An organization whose key cannot be read is skipped; its items stay hidden.
        }
      }
    }
    return new VaultKeys(crypto, userKey, orgKeys)
  }

  /** The key of an organization whose key could be read. */
  forOrganization(organizationId: string): Uint8Array | undefined {
    return this.orgKeys.get(organizationId)
  }

  /** The key of an item: its own key when it has one, else the key of its owner. */
  forCipher(cipher: unknown): Uint8Array {
    const orgId = prop(cipher, "OrganizationId")
    const ownerKey =
      typeof orgId === "string" ? this.orgKeys.get(orgId) : this.userKey
    if (!ownerKey) throw new Error("Missing organization key")
    const itemKey = prop(cipher, "Key")
    if (typeof itemKey !== "string" || !itemKey) return ownerKey
    return this.crypto.unwrapKey(itemKey, ownerKey)
  }

  decrypt(value: unknown, key: Uint8Array): string {
    return typeof value === "string" && value
      ? this.crypto.decryptString(value, key)
      : ""
  }

  encrypt(value: string, key: Uint8Array): string | null {
    return value ? this.crypto.encryptString(value, key) : null
  }
}

/** Logins and notes in the trash, archived or not. */
export function trashedCiphers(sync: unknown): Record<string, unknown>[] {
  const ciphers = prop(sync, "Ciphers")
  if (!Array.isArray(ciphers)) return []
  return ciphers.filter(
    (cipher) =>
      (prop(cipher, "Type") === CIPHER_TYPE_LOGIN ||
        prop(cipher, "Type") === CIPHER_TYPE_SECURE_NOTE) &&
      Boolean(prop(cipher, "DeletedDate")),
  )
}

/** A trashed login or note as the trash lists it; its secrets stay encrypted. */
export function decryptTrashed(
  cipher: Record<string, unknown>,
  keys: VaultKeys,
): TrashedItem {
  const common = {
    id: String(prop(cipher, "Id")),
    deletedAt: timeOf(prop(cipher, "DeletedDate")),
    editable: prop(cipher, "Edit") !== false,
    grouping: groupingOf(cipher),
  }
  if (prop(cipher, "Type") === CIPHER_TYPE_SECURE_NOTE)
    return { ...common, kind: "note", name: decryptNote(cipher, keys).name }
  const login = decryptLogin(cipher, keys)
  return {
    ...common,
    kind: "login",
    name: login.name,
    username: login.username,
    host:
      login.uris.map((u) => hostOfSavedUri(u.uri)).find((h) => h !== null) ??
      undefined,
  }
}

/** Items in the trash or the archive stay out of lists, search and filling, as in Bitwarden's apps. */
function isListed(cipher: unknown): boolean {
  return !prop(cipher, "DeletedDate") && !prop(cipher, "ArchivedDate")
}

export function loginCiphers(sync: unknown): Record<string, unknown>[] {
  const ciphers = prop(sync, "Ciphers")
  if (!Array.isArray(ciphers)) return []
  return ciphers.filter(
    (cipher) => prop(cipher, "Type") === CIPHER_TYPE_LOGIN && isListed(cipher),
  )
}

/** A secure note as lists show it; its text stays encrypted until it is opened. */
export interface NoteItem {
  id: string
  name: string
  /** Whether the note asks for the master password before its text is shown. */
  reprompt: boolean
  grouping: ItemGrouping
  favorite: boolean
}

export function noteCiphers(sync: unknown): Record<string, unknown>[] {
  const ciphers = prop(sync, "Ciphers")
  if (!Array.isArray(ciphers)) return []
  return ciphers.filter(
    (cipher) =>
      prop(cipher, "Type") === CIPHER_TYPE_SECURE_NOTE && isListed(cipher),
  )
}

export function decryptNote(
  cipher: Record<string, unknown>,
  keys: VaultKeys,
): NoteItem {
  return {
    id: String(prop(cipher, "Id")),
    name: keys.decrypt(prop(cipher, "Name"), keys.forCipher(cipher)),
    reprompt: prop(cipher, "Reprompt") === 1,
    grouping: groupingOf(cipher),
    favorite: prop(cipher, "Favorite") === true,
  }
}

function groupingOf(cipher: Record<string, unknown>): ItemGrouping {
  const organizationId = prop(cipher, "OrganizationId")
  const folderId = prop(cipher, "FolderId")
  const collectionIds = prop(cipher, "CollectionIds")
  return {
    organizationId: isNonEmptyString(organizationId) ? organizationId : null,
    folderId: isNonEmptyString(folderId) ? folderId : null,
    collectionIds: Array.isArray(collectionIds)
      ? collectionIds.filter(isNonEmptyString)
      : [],
  }
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/**
 * The organizations, folders and collections of a sync, with their names decrypted. Those whose
 * key or name cannot be read are left out, as their items are.
 */
export function decryptGroups(sync: unknown, keys: VaultKeys): VaultGroups {
  const organizations = listOf(
    prop(prop(sync, "Profile"), "Organizations"),
  ).flatMap((organization) => {
    const id = prop(organization, "Id")
    const name = prop(organization, "Name")
    return isNonEmptyString(id) &&
      typeof name === "string" &&
      keys.forOrganization(id)
      ? [{ id, name }]
      : []
  })
  const folders = listOf(prop(sync, "Folders")).flatMap((folder) => {
    const id = prop(folder, "Id")
    if (!isNonEmptyString(id)) return []
    try {
      return [{ id, name: keys.decrypt(prop(folder, "Name"), keys.userKey) }]
    } catch {
      return []
    }
  })
  const collections = listOf(prop(sync, "Collections")).flatMap(
    (collection) => {
      const id = prop(collection, "Id")
      const organizationId = prop(collection, "OrganizationId")
      if (!isNonEmptyString(id) || !isNonEmptyString(organizationId)) return []
      const key = keys.forOrganization(organizationId)
      if (!key) return []
      try {
        const name = keys.decrypt(prop(collection, "Name"), key)
        return [{ id, organizationId, name }]
      } catch {
        return []
      }
    },
  )
  return { organizations, folders, collections }
}

/** Whether a text contains every word of the query, ignoring case. */
export function textMatchesQuery(text: string, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const lowerText = text.toLowerCase()
  return words.length > 0 && words.every((word) => lowerText.includes(word))
}

function isMatchType(value: unknown): value is MatchType {
  return Object.values(MatchType).includes(value as MatchType)
}

/** Decrypts what lists and matching need. The password stays encrypted until it is asked for. */
export function decryptLogin(
  cipher: Record<string, unknown>,
  keys: VaultKeys,
): LoginItem {
  const key = keys.forCipher(cipher)
  const login = pick(cipher, "Login")
  const uris = prop(login, "Uris")
  const orgId = prop(cipher, "OrganizationId")
  return {
    id: String(prop(cipher, "Id")),
    organizationId: typeof orgId === "string" ? orgId : null,
    grouping: groupingOf(cipher),
    favorite: prop(cipher, "Favorite") === true,
    name: keys.decrypt(prop(cipher, "Name"), key),
    username: keys.decrypt(prop(login, "Username"), key),
    uris: Array.isArray(uris)
      ? uris.map((u) => {
          const match = prop(u, "Match")
          return {
            uri: keys.decrypt(prop(u, "Uri"), key),
            match: isMatchType(match) ? match : null,
          }
        })
      : [],
    hasTotp: isNonEmptyString(prop(login, "Totp")),
    reprompt: prop(cipher, "Reprompt") === 1,
  }
}

/** Whether the item's name, username or addresses contain every word of the query, ignoring case. */
export function matchesQuery(item: LoginItem, query: string): boolean {
  const text = [item.name, item.username, ...item.uris.map((u) => u.uri)]
  return textMatchesQuery(text.join("\n"), query)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== ""
}

function timeOf(value: unknown): number | undefined {
  const time = typeof value === "string" ? Date.parse(value) : Number.NaN
  return Number.isNaN(time) ? undefined : time
}

export interface ItemDetails {
  notes: string
  customFields: CustomField[]
  pastPasswordCount: number
  created?: number
  modified?: number
  passwordModified?: number
  /** Whether the login keeps a passkey besides its password. */
  hasPasskey: boolean
}

/** Bitwarden's field types and the login fields a linked field can stand for. */
const FIELD_TEXT = 0
const FIELD_HIDDEN = 1
const FIELD_BOOLEAN = 2
const FIELD_LINKED = 3
const LINKED_USERNAME = 100
const LINKED_PASSWORD = 101

/** How many earlier passwords Bitwarden's apps keep for an item. */
const MAX_PASSWORD_HISTORY = 5

function decryptCustomField(
  field: unknown,
  keys: VaultKeys,
  key: Uint8Array,
): CustomField | null {
  const name = keys.decrypt(prop(field, "Name"), key)
  const value = () => keys.decrypt(prop(field, "Value"), key)
  switch (prop(field, "Type")) {
    case FIELD_TEXT:
      return { kind: "text", name, value: value() }
    case FIELD_HIDDEN:
      return { kind: "hidden", name, value: value() }
    case FIELD_BOOLEAN:
      return { kind: "checkbox", name, checked: value() === "true" }
    case FIELD_LINKED: {
      const linkedId = prop(field, "LinkedId")
      if (linkedId === LINKED_USERNAME)
        return { kind: "linked", name, linkedTo: "username" }
      if (linkedId === LINKED_PASSWORD)
        return { kind: "linked", name, linkedTo: "password" }
      return null
    }
    default:
      return null
  }
}

/** A custom field as the server stores it, encrypted with the item key. */
function encryptCustomField(
  field: CustomField,
  keys: VaultKeys,
  key: Uint8Array,
): Record<string, unknown> {
  const name = keys.encrypt(field.name, key)
  switch (field.kind) {
    case "text":
    case "hidden":
      return {
        type: field.kind === "text" ? FIELD_TEXT : FIELD_HIDDEN,
        name,
        value: keys.encrypt(field.value, key),
        linkedId: null,
      }
    case "checkbox":
      return {
        type: FIELD_BOOLEAN,
        name,
        value: keys.encrypt(String(field.checked), key),
        linkedId: null,
      }
    case "linked":
      return {
        type: FIELD_LINKED,
        name,
        value: null,
        linkedId:
          field.linkedTo === "username" ? LINKED_USERNAME : LINKED_PASSWORD,
      }
  }
}

function savedFieldRequest(field: unknown): Record<string, unknown> {
  return {
    type: prop(field, "Type"),
    name: prop(field, "Name"),
    value: prop(field, "Value"),
    linkedId: prop(field, "LinkedId") ?? null,
  }
}

/**
 * The item's custom fields for a request. A field this code cannot read is kept as saved, so an
 * edit never drops it.
 */
function customFieldsRequest(
  cipher: Record<string, unknown>,
  next: CustomField[] | undefined,
  keys: VaultKeys,
  key: Uint8Array,
): Record<string, unknown>[] {
  const saved = savedList(cipher, "Fields")
  if (next === undefined) return saved.map(savedFieldRequest)
  const unreadable = saved.filter(
    (field) => decryptCustomField(field, keys, key) === null,
  )
  return [
    ...next.map((field) => encryptCustomField(field, keys, key)),
    ...unreadable.map(savedFieldRequest),
  ]
}

/**
 * Hidden fields whose value the change replaces or removes. Bitwarden's apps keep their old values in
 * the password history as "name: value", so a secret never goes away unnoticed.
 */
function replacedHiddenValues(
  cipher: Record<string, unknown>,
  next: CustomField[] | undefined,
  keys: VaultKeys,
  key: Uint8Array,
): string[] {
  if (next === undefined) return []
  const savedHidden = savedList(cipher, "Fields")
    .map((field) => decryptCustomField(field, keys, key))
    .filter((field) => field?.kind === "hidden" && field.name && field.value)
  return savedHidden.flatMap((field) => {
    if (field?.kind !== "hidden") return []
    const stillThere = next.some(
      (candidate) =>
        candidate.kind === "hidden" &&
        candidate.name === field.name &&
        candidate.value === field.value,
    )
    return stillThere ? [] : [`${field.name}: ${field.value}`]
  })
}

function savedList(cipher: Record<string, unknown>, name: string): unknown[] {
  const list = prop(cipher, name)
  return Array.isArray(list) ? list : []
}

/** The parts of an item that only its detail view shows. */
export function decryptDetails(
  cipher: Record<string, unknown>,
  keys: VaultKeys,
): ItemDetails {
  const key = keys.forCipher(cipher)
  const customFields = savedList(cipher, "Fields")
    .map((field) => decryptCustomField(field, keys, key))
    .filter((field) => field !== null)
  return {
    notes: keys.decrypt(prop(cipher, "Notes"), key),
    customFields,
    pastPasswordCount: savedList(cipher, "PasswordHistory").length,
    created: timeOf(prop(cipher, "CreationDate")),
    modified: timeOf(prop(cipher, "RevisionDate")),
    passwordModified: timeOf(
      prop(pick(cipher, "Login"), "PasswordRevisionDate"),
    ),
    hasPasskey:
      savedList(pick(cipher, "Login") ?? {}, "Fido2Credentials").length > 0,
  }
}

/** The item's earlier passwords, newest first, as Bitwarden's apps keep them. */
export function decryptPasswordHistory(
  cipher: Record<string, unknown>,
  keys: VaultKeys,
): PastPassword[] {
  const key = keys.forCipher(cipher)
  const history = savedList(cipher, "PasswordHistory").map((entry) => ({
    password: keys.decrypt(prop(entry, "Password"), key),
    replaced: timeOf(prop(entry, "LastUsedDate")),
  }))
  const newestFirst = (first: PastPassword, second: PastPassword) =>
    (second.replaced ?? 0) - (first.replaced ?? 0)
  return history.sort(newestFirst)
}

/** The item's authenticator key: an `otpauth://` URI, a `steam://` key or a base32 secret. */
export function decryptTotp(
  cipher: Record<string, unknown>,
  keys: VaultKeys,
): string {
  return keys.decrypt(
    prop(pick(cipher, "Login"), "Totp"),
    keys.forCipher(cipher),
  )
}

export function decryptPassword(
  cipher: Record<string, unknown>,
  keys: VaultKeys,
): string {
  return keys.decrypt(
    prop(pick(cipher, "Login"), "Password"),
    keys.forCipher(cipher),
  )
}

export interface NewLoginFields {
  name: string
  username: string
  password: string
  uri: string
  notes?: string
  /** An authenticator key, already checked. */
  totp?: string
  customFields?: CustomField[]
  folderId?: string | null
}

/** The request body for a new personal login item, encrypted with the account key. */
export function newLoginRequest(
  login: NewLoginFields,
  keys: VaultKeys,
  userId: string,
): Record<string, unknown> {
  const key = keys.userKey
  return {
    type: CIPHER_TYPE_LOGIN,
    encryptedFor: userId,
    folderId: login.folderId ?? null,
    organizationId: null,
    name: keys.encrypt(login.name, key),
    notes: keys.encrypt(login.notes ?? "", key),
    favorite: false,
    reprompt: 0,
    key: null,
    fields: (login.customFields ?? []).map((field) =>
      encryptCustomField(field, keys, key),
    ),
    login: {
      username: keys.encrypt(login.username, key),
      password: keys.encrypt(login.password, key),
      uris: login.uri
        ? [{ uri: keys.encrypt(login.uri, key), match: null }]
        : [],
      totp: keys.encrypt(login.totp ?? "", key),
    },
  }
}

/** The request body for a new personal secure note, encrypted with the account key. */
export function newNoteRequest(
  note: EditableNote,
  keys: VaultKeys,
  userId: string,
): Record<string, unknown> {
  const key = keys.userKey
  return {
    type: CIPHER_TYPE_SECURE_NOTE,
    encryptedFor: userId,
    folderId: null,
    organizationId: null,
    name: keys.encrypt(note.name, key),
    notes: keys.encrypt(note.text, key),
    favorite: false,
    reprompt: 0,
    key: null,
    fields: note.customFields.map((field) =>
      encryptCustomField(field, keys, key),
    ),
    secureNote: { type: 0 },
  }
}

/** What an update changes in a login item; fields left out stay as they are, empty ones are cleared. */
export interface ItemChange {
  name?: string
  username?: string
  password?: string
  uris?: Website[]
  notes?: string
  /** An authenticator key: an `otpauth://` URI, a `steam://` key or a base32 secret. */
  totp?: string
  /** The item's whole list of custom fields. */
  customFields?: CustomField[]
}

/**
 * The SHA-256 of an address in base64. Bitwarden's apps drop an address of an item with its own key
 * unless the item carries this checksum, encrypted, next to it.
 */
async function uriHash(uri: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(uri),
  )
  return new Uint8Array(digest).toBase64()
}

/**
 * The item's addresses for a request: kept ones as they were saved, with the match chosen now, and
 * new ones encrypted with checksums.
 */
async function urisRequest(
  saved: unknown,
  next: Website[] | undefined,
  keys: VaultKeys,
  key: Uint8Array,
): Promise<Record<string, unknown>[]> {
  const current = Array.isArray(saved)
    ? saved.map((u) => ({
        uri: prop(u, "Uri") ?? null,
        match: prop(u, "Match") ?? null,
        uriChecksum: prop(u, "UriChecksum") ?? null,
      }))
    : []
  if (next === undefined) return current
  const byText = new Map(
    current.map((u) => [keys.decrypt(u.uri, key), u] as const),
  )
  return Promise.all(
    next
      .filter((website) => website.uri !== "")
      .map(async ({ uri, match }) => {
        const kept = byText.get(uri)
        return kept
          ? { ...kept, match }
          : {
              uri: keys.encrypt(uri, key),
              match,
              uriChecksum: keys.encrypt(await uriHash(uri), key),
            }
      }),
  )
}

/**
 * The request body that updates a login or a secure note. The server replaces the whole item, so
 * the other encrypted fields are sent back unchanged; a replaced password moves to the history.
 */
export async function itemUpdateRequest(
  cipher: Record<string, unknown>,
  change: ItemChange,
  keys: VaultKeys,
  userId: string,
): Promise<Record<string, unknown>> {
  const key = keys.forCipher(cipher)
  const login = pick(cipher, "Login") ?? {}
  /** The field's new value encrypted, or the saved one when the change leaves it out. */
  const field = (value: string | undefined, saved: unknown) =>
    value === undefined ? (saved ?? null) : keys.encrypt(value, key)
  const now = new Date().toISOString()
  const oldPassword = prop(login, "Password")
  const kept = savedList(cipher, "PasswordHistory").map((entry) => ({
    password: prop(entry, "Password"),
    lastUsedDate: prop(entry, "LastUsedDate"),
  }))
  const replacedPassword =
    change.password !== undefined &&
    typeof oldPassword === "string" &&
    oldPassword
      ? [oldPassword]
      : []
  const replacedFields = replacedHiddenValues(
    cipher,
    change.customFields,
    keys,
    key,
  ).map((text) => keys.encrypt(text, key))
  const replaced = [...replacedPassword, ...replacedFields].map((password) => ({
    password,
    lastUsedDate: now,
  }))
  const passwordHistory = replaced.length
    ? [...replaced, ...kept].slice(0, MAX_PASSWORD_HISTORY)
    : kept
  const common = {
    encryptedFor: userId,
    folderId: prop(cipher, "FolderId") ?? null,
    organizationId: prop(cipher, "OrganizationId") ?? null,
    name: field(change.name, prop(cipher, "Name")),
    notes: field(change.notes, prop(cipher, "Notes")),
    favorite: prop(cipher, "Favorite") ?? false,
    reprompt: prop(cipher, "Reprompt") ?? 0,
    key: prop(cipher, "Key") ?? null,
    lastKnownRevisionDate: prop(cipher, "RevisionDate") ?? null,
    fields: customFieldsRequest(cipher, change.customFields, keys, key),
    passwordHistory: passwordHistory.length ? passwordHistory : null,
  }
  if (prop(cipher, "Type") === CIPHER_TYPE_SECURE_NOTE) {
    const secureNote = pick(cipher, "SecureNote")
    return {
      type: CIPHER_TYPE_SECURE_NOTE,
      ...common,
      secureNote: { type: prop(secureNote, "Type") ?? 0 },
    }
  }
  return {
    type: CIPHER_TYPE_LOGIN,
    ...common,
    login: {
      username: field(change.username, prop(login, "Username")),
      password: field(change.password, oldPassword),
      passwordRevisionDate:
        change.password === undefined
          ? (prop(login, "PasswordRevisionDate") ?? null)
          : now,
      totp: field(change.totp, prop(login, "Totp")),
      autofillOnPageLoad: prop(login, "AutofillOnPageLoad") ?? null,
      fido2Credentials: prop(login, "Fido2Credentials") ?? null,
      uris: await urisRequest(prop(login, "Uris"), change.uris, keys, key),
    },
  }
}

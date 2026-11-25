import type { CustomField, PastPassword } from "@/lib/providers/types"
import { MatchType } from "@/lib/settings"
import { pick, prop } from "./api"
import type { VaultCrypto } from "./crypto"

const CIPHER_TYPE_LOGIN = 1

export interface LoginItem {
  id: string
  organizationId: string | null
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

export function loginCiphers(sync: unknown): Record<string, unknown>[] {
  const ciphers = prop(sync, "Ciphers")
  if (!Array.isArray(ciphers)) return []
  return ciphers.filter(
    (cipher) =>
      prop(cipher, "Type") === CIPHER_TYPE_LOGIN &&
      !prop(cipher, "DeletedDate"),
  )
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
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return false
  const text = [item.name, item.username, ...item.uris.map((u) => u.uri)]
    .join("\n")
    .toLowerCase()
  return words.every((word) => text.includes(word))
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
}

/** Bitwarden's field types and the login fields a linked field can stand for. */
const FIELD_TEXT = 0
const FIELD_HIDDEN = 1
const FIELD_BOOLEAN = 2
const FIELD_LINKED = 3
const LINKED_USERNAME = 100
const LINKED_PASSWORD = 101

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
    folderId: null,
    organizationId: null,
    name: keys.encrypt(login.name, key),
    notes: null,
    favorite: false,
    reprompt: 0,
    key: null,
    login: {
      username: keys.encrypt(login.username, key),
      password: keys.encrypt(login.password, key),
      uris: login.uri
        ? [{ uri: keys.encrypt(login.uri, key), match: null }]
        : [],
      totp: null,
    },
  }
}

/** What an update changes in a login item; fields left out stay as they are, empty ones are cleared. */
export interface ItemChange {
  name?: string
  username?: string
  password?: string
  uris?: string[]
  notes?: string
  /** An authenticator key: an `otpauth://` URI, a `steam://` key or a base32 secret. */
  totp?: string
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

/** The item's addresses for a request: unchanged ones as they are, new ones encrypted with checksums. */
async function urisRequest(
  saved: unknown,
  next: string[] | undefined,
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
      .filter((uri) => uri !== "")
      .map(
        async (uri) =>
          byText.get(uri) ?? {
            uri: keys.encrypt(uri, key),
            match: null,
            uriChecksum: keys.encrypt(await uriHash(uri), key),
          },
      ),
  )
}

/**
 * The request body that updates a login item. The server replaces the whole item, so the other
 * encrypted fields are sent back unchanged; a replaced password moves to the history.
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
  const history = prop(cipher, "PasswordHistory")
  const kept = Array.isArray(history)
    ? history.map((h) => ({
        password: prop(h, "Password"),
        lastUsedDate: prop(h, "LastUsedDate"),
      }))
    : []
  const passwordHistory =
    change.password === undefined
      ? kept
      : [
          ...(typeof oldPassword === "string" && oldPassword
            ? [{ password: oldPassword, lastUsedDate: now }]
            : []),
          ...kept,
        ].slice(0, 5)
  const fields = prop(cipher, "Fields")
  return {
    type: CIPHER_TYPE_LOGIN,
    encryptedFor: userId,
    folderId: prop(cipher, "FolderId") ?? null,
    organizationId: prop(cipher, "OrganizationId") ?? null,
    name: field(change.name, prop(cipher, "Name")),
    notes: field(change.notes, prop(cipher, "Notes")),
    favorite: prop(cipher, "Favorite") ?? false,
    reprompt: prop(cipher, "Reprompt") ?? 0,
    key: prop(cipher, "Key") ?? null,
    lastKnownRevisionDate: prop(cipher, "RevisionDate") ?? null,
    fields: Array.isArray(fields)
      ? fields.map((f) => ({
          type: prop(f, "Type"),
          name: prop(f, "Name"),
          value: prop(f, "Value"),
          linkedId: prop(f, "LinkedId") ?? null,
        }))
      : null,
    passwordHistory: passwordHistory.length ? passwordHistory : null,
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

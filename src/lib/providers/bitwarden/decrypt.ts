import type {
  CustomField,
  ItemGrouping,
  PastPassword,
  TrashedItem,
  VaultGroups,
} from "@/lib/providers/types"
import { MatchType } from "@/lib/settings"
import { hostOfSavedUri } from "@/lib/site"
import { listOf, pick, prop } from "./api"
import {
  CIPHER_TYPE_LOGIN,
  CIPHER_TYPE_SECURE_NOTE,
  FIELD_BOOLEAN,
  FIELD_HIDDEN,
  FIELD_LINKED,
  FIELD_TEXT,
  LINKED_PASSWORD,
  LINKED_USERNAME,
  REPROMPT_PASSWORD,
} from "./cipher-types"
import type { VaultKeys } from "./keys"

export interface LoginItem {
  id: string
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

/** A secure note as lists show it; its text stays encrypted until it is opened. */
export interface NoteItem {
  id: string
  name: string
  /** Whether the note asks for the master password before its text is shown. */
  reprompt: boolean
  grouping: ItemGrouping
  favorite: boolean
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== ""
}

function isMatchType(value: unknown): value is MatchType {
  return Object.values(MatchType).includes(value as MatchType)
}

function timeOf(value: unknown): number | undefined {
  const time = typeof value === "string" ? Date.parse(value) : Number.NaN
  return Number.isNaN(time) ? undefined : time
}

/** Items in the trash or the archive stay out of lists, search and filling, as in Bitwarden's apps. */
function isListed(cipher: Record<string, unknown>): boolean {
  return !prop(cipher, "DeletedDate") && !prop(cipher, "ArchivedDate")
}

/** The items of a sync that `keep` accepts. */
function ciphersOf(
  sync: unknown,
  keep: (cipher: Record<string, unknown>) => boolean,
): Record<string, unknown>[] {
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null
  return listOf(prop(sync, "Ciphers")).filter(
    (cipher): cipher is Record<string, unknown> =>
      isRecord(cipher) && keep(cipher),
  )
}

export function loginCiphers(sync: unknown): Record<string, unknown>[] {
  return ciphersOf(
    sync,
    (cipher) => prop(cipher, "Type") === CIPHER_TYPE_LOGIN && isListed(cipher),
  )
}

export function noteCiphers(sync: unknown): Record<string, unknown>[] {
  return ciphersOf(
    sync,
    (cipher) =>
      prop(cipher, "Type") === CIPHER_TYPE_SECURE_NOTE && isListed(cipher),
  )
}

/** Logins and notes in the trash, archived or not. */
export function trashedCiphers(sync: unknown): Record<string, unknown>[] {
  return ciphersOf(sync, (cipher) => {
    const type = prop(cipher, "Type")
    return (
      (type === CIPHER_TYPE_LOGIN || type === CIPHER_TYPE_SECURE_NOTE) &&
      Boolean(prop(cipher, "DeletedDate"))
    )
  })
}

function groupingOf(cipher: Record<string, unknown>): ItemGrouping {
  const organizationId = prop(cipher, "OrganizationId")
  const folderId = prop(cipher, "FolderId")
  return {
    organizationId: isNonEmptyString(organizationId) ? organizationId : null,
    folderId: isNonEmptyString(folderId) ? folderId : null,
    collectionIds: listOf(prop(cipher, "CollectionIds")).filter(
      isNonEmptyString,
    ),
  }
}

/** Decrypts what lists and matching need. The password stays encrypted until it is asked for. */
export function decryptLogin(
  cipher: Record<string, unknown>,
  keys: VaultKeys,
): LoginItem {
  const key = keys.forCipher(cipher)
  const login = pick(cipher, "Login")
  return {
    id: String(prop(cipher, "Id")),
    grouping: groupingOf(cipher),
    favorite: prop(cipher, "Favorite") === true,
    name: keys.decrypt(prop(cipher, "Name"), key),
    username: keys.decrypt(prop(login, "Username"), key),
    uris: listOf(prop(login, "Uris")).map((savedUri) => {
      const match = prop(savedUri, "Match")
      return {
        uri: keys.decrypt(prop(savedUri, "Uri"), key),
        match: isMatchType(match) ? match : null,
      }
    }),
    hasTotp: isNonEmptyString(prop(login, "Totp")),
    reprompt: prop(cipher, "Reprompt") === REPROMPT_PASSWORD,
  }
}

export function decryptNote(
  cipher: Record<string, unknown>,
  keys: VaultKeys,
): NoteItem {
  return {
    id: String(prop(cipher, "Id")),
    name: keys.decrypt(prop(cipher, "Name"), keys.forCipher(cipher)),
    reprompt: prop(cipher, "Reprompt") === REPROMPT_PASSWORD,
    grouping: groupingOf(cipher),
    favorite: prop(cipher, "Favorite") === true,
  }
}

/** The host of the login's first saved address that has one. */
export function firstHostOf(login: LoginItem): string | undefined {
  for (const { uri } of login.uris) {
    const host = hostOfSavedUri(uri)
    if (host !== null) return host
  }
  return undefined
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
    host: firstHostOf(login),
  }
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

/** Whether the item's name, username or addresses contain every word of the query, ignoring case. */
export function matchesQuery(item: LoginItem, query: string): boolean {
  const text = [item.name, item.username, ...item.uris.map(({ uri }) => uri)]
  return textMatchesQuery(text.join("\n"), query)
}

/** A saved custom field, or null for one of a kind this code does not read. */
export function decryptCustomField(
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

/** The parts of an item that only its detail view shows. */
export function decryptDetails(
  cipher: Record<string, unknown>,
  keys: VaultKeys,
): ItemDetails {
  const key = keys.forCipher(cipher)
  const login = pick(cipher, "Login")
  const customFields = listOf(prop(cipher, "Fields"))
    .map((field) => decryptCustomField(field, keys, key))
    .filter((field) => field !== null)
  return {
    notes: keys.decrypt(prop(cipher, "Notes"), key),
    customFields,
    pastPasswordCount: listOf(prop(cipher, "PasswordHistory")).length,
    created: timeOf(prop(cipher, "CreationDate")),
    modified: timeOf(prop(cipher, "RevisionDate")),
    passwordModified: timeOf(prop(login, "PasswordRevisionDate")),
    hasPasskey: listOf(prop(login, "Fido2Credentials")).length > 0,
  }
}

/** The item's earlier passwords, newest first, as Bitwarden's apps keep them. */
export function decryptPasswordHistory(
  cipher: Record<string, unknown>,
  keys: VaultKeys,
): PastPassword[] {
  const key = keys.forCipher(cipher)
  const history = listOf(prop(cipher, "PasswordHistory")).map((entry) => ({
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

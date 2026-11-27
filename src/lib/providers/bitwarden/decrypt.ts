import type { StoredPasskey } from "@/lib/passkeys/types"
import type {
  ArchivedItem,
  CustomField,
  ItemGrouping,
  PastPassword,
  TrashedItem,
  VaultGroups,
} from "@/lib/providers/types"
import { MatchType } from "@/lib/settings"
import { hostOfSavedUri } from "@/lib/site"
import { listOf, objectAt, valueAt } from "./api"
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
  /** Non-secret decrypted text (notes and non-hidden custom fields) indexed for in-memory search. */
  searchableText?: string
}

/** A secure note as lists show it; its text stays encrypted until it is opened. */
export interface NoteItem {
  id: string
  name: string
  /** Whether the note asks for the master password before its text is shown. */
  reprompt: boolean
  grouping: ItemGrouping
  favorite: boolean
  /** Non-reprompt note body and non-hidden custom fields indexed for in-memory search. */
  searchableText?: string
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
  return !valueAt(cipher, "DeletedDate") && !valueAt(cipher, "ArchivedDate")
}

/** The items of a sync that `keep` accepts. */
function ciphersOf(
  sync: unknown,
  keep: (cipher: Record<string, unknown>) => boolean,
): Record<string, unknown>[] {
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null
  return listOf(valueAt(sync, "Ciphers")).filter(
    (cipher): cipher is Record<string, unknown> =>
      isRecord(cipher) && keep(cipher),
  )
}

export function loginCiphers(sync: unknown): Record<string, unknown>[] {
  return ciphersOf(
    sync,
    (cipher) =>
      valueAt(cipher, "Type") === CIPHER_TYPE_LOGIN && isListed(cipher),
  )
}

export function noteCiphers(sync: unknown): Record<string, unknown>[] {
  return ciphersOf(
    sync,
    (cipher) =>
      valueAt(cipher, "Type") === CIPHER_TYPE_SECURE_NOTE && isListed(cipher),
  )
}

/** Logins and notes in the trash, archived or not. */
export function trashedCiphers(sync: unknown): Record<string, unknown>[] {
  return ciphersOf(sync, (cipher) => {
    const type = valueAt(cipher, "Type")
    return (
      (type === CIPHER_TYPE_LOGIN || type === CIPHER_TYPE_SECURE_NOTE) &&
      Boolean(valueAt(cipher, "DeletedDate"))
    )
  })
}

/** Logins and notes in the archive (and not in the trash). */
export function archivedCiphers(sync: unknown): Record<string, unknown>[] {
  return ciphersOf(sync, (cipher) => {
    const type = valueAt(cipher, "Type")
    return (
      (type === CIPHER_TYPE_LOGIN || type === CIPHER_TYPE_SECURE_NOTE) &&
      !valueAt(cipher, "DeletedDate") &&
      Boolean(valueAt(cipher, "ArchivedDate"))
    )
  })
}

function groupingOf(cipher: Record<string, unknown>): ItemGrouping {
  const organizationId = valueAt(cipher, "OrganizationId")
  const folderId = valueAt(cipher, "FolderId")
  return {
    organizationId: isNonEmptyString(organizationId) ? organizationId : null,
    folderId: isNonEmptyString(folderId) ? folderId : null,
    collectionIds: listOf(valueAt(cipher, "CollectionIds")).filter(
      isNonEmptyString,
    ),
  }
}

/** Non-secret notes and custom field names/values for in-memory search; omitted on reprompt items. */
function searchableTextOf(
  cipher: Record<string, unknown>,
  keys: VaultKeys,
  key: Uint8Array,
  reprompt: boolean,
): string {
  if (reprompt) return ""
  const parts: string[] = []
  const notes = keys.decrypt(valueAt(cipher, "Notes"), key)
  if (notes) parts.push(notes)
  for (const raw of listOf(valueAt(cipher, "Fields"))) {
    try {
      const field = decryptCustomField(raw, keys, key)
      if (!field) continue
      if (field.name) parts.push(field.name)
      if (field.kind === "text" && field.value) parts.push(field.value)
    } catch {
      // Skip unreadable custom field.
    }
  }
  return parts.join("\n")
}

/** Decrypts what lists and matching need. The password stays encrypted until it is asked for. */
export function decryptLogin(
  cipher: Record<string, unknown>,
  keys: VaultKeys,
): LoginItem {
  const key = keys.forCipher(cipher)
  const login = objectAt(cipher, "Login")
  const reprompt = valueAt(cipher, "Reprompt") === REPROMPT_PASSWORD
  return {
    id: String(valueAt(cipher, "Id")),
    grouping: groupingOf(cipher),
    favorite: valueAt(cipher, "Favorite") === true,
    name: keys.decrypt(valueAt(cipher, "Name"), key),
    username: keys.decrypt(valueAt(login, "Username"), key),
    uris: listOf(valueAt(login, "Uris")).map((savedUri) => {
      const match = valueAt(savedUri, "Match")
      return {
        uri: keys.decrypt(valueAt(savedUri, "Uri"), key),
        match: isMatchType(match) ? match : null,
      }
    }),
    hasTotp: isNonEmptyString(valueAt(login, "Totp")),
    reprompt,
    searchableText: searchableTextOf(cipher, keys, key, reprompt),
  }
}

export function decryptNote(
  cipher: Record<string, unknown>,
  keys: VaultKeys,
): NoteItem {
  const key = keys.forCipher(cipher)
  const reprompt = valueAt(cipher, "Reprompt") === REPROMPT_PASSWORD
  return {
    id: String(valueAt(cipher, "Id")),
    name: keys.decrypt(valueAt(cipher, "Name"), key),
    reprompt,
    grouping: groupingOf(cipher),
    favorite: valueAt(cipher, "Favorite") === true,
    searchableText: searchableTextOf(cipher, keys, key, reprompt),
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

/** Shared summary fields for an inactive (trashed or archived) login or note. */
function decryptInactiveBase(
  cipher: Record<string, unknown>,
  keys: VaultKeys,
):
  | {
      id: string
      editable: boolean
      grouping: ItemGrouping
      kind: "note"
      name: string
    }
  | {
      id: string
      editable: boolean
      grouping: ItemGrouping
      kind: "login"
      name: string
      username: string
      host?: string
    } {
  const common = {
    id: String(valueAt(cipher, "Id")),
    editable: valueAt(cipher, "Edit") !== false,
    grouping: groupingOf(cipher),
  }
  if (valueAt(cipher, "Type") === CIPHER_TYPE_SECURE_NOTE)
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

/** A trashed login or note as the trash lists it; its secrets stay encrypted. */
export function decryptTrashed(
  cipher: Record<string, unknown>,
  keys: VaultKeys,
): TrashedItem {
  return {
    ...decryptInactiveBase(cipher, keys),
    deletedAt: timeOf(valueAt(cipher, "DeletedDate")),
  }
}

/** An archived login or note as the archive lists it; its secrets stay encrypted. */
export function decryptArchived(
  cipher: Record<string, unknown>,
  keys: VaultKeys,
): ArchivedItem {
  return {
    ...decryptInactiveBase(cipher, keys),
    archivedAt: timeOf(valueAt(cipher, "ArchivedDate")),
  }
}

/**
 * The organizations, folders and collections of a sync, with their names decrypted. Those whose
 * key or name cannot be read are left out, as their items are.
 */
export function decryptGroups(sync: unknown, keys: VaultKeys): VaultGroups {
  const organizations = listOf(
    valueAt(valueAt(sync, "Profile"), "Organizations"),
  ).flatMap((organization) => {
    const id = valueAt(organization, "Id")
    const name = valueAt(organization, "Name")
    return isNonEmptyString(id) &&
      typeof name === "string" &&
      keys.forOrganization(id)
      ? [{ id, name }]
      : []
  })
  const folders = listOf(valueAt(sync, "Folders")).flatMap((folder) => {
    const id = valueAt(folder, "Id")
    if (!isNonEmptyString(id)) return []
    try {
      return [{ id, name: keys.decrypt(valueAt(folder, "Name"), keys.userKey) }]
    } catch {
      return []
    }
  })
  const collections = listOf(valueAt(sync, "Collections")).flatMap(
    (collection) => {
      const id = valueAt(collection, "Id")
      const organizationId = valueAt(collection, "OrganizationId")
      if (!isNonEmptyString(id) || !isNonEmptyString(organizationId)) return []
      const key = keys.forOrganization(organizationId)
      if (!key) return []
      try {
        const name = keys.decrypt(valueAt(collection, "Name"), key)
        return [{ id, organizationId, name }]
      } catch {
        return []
      }
    },
  )
  return { organizations, folders, collections }
}

/** Extracts custom and non-excluded global equivalent domain groups from a Bitwarden /sync payload. */
export function decryptEquivalentDomains(sync: unknown): string[][] {
  const domains = objectAt(sync, "Domains")
  if (!domains) return []
  const groups: string[][] = []
  const pushGroup = (raw: unknown) => {
    const entries = listOf(raw)
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
    if (entries.length >= 2) groups.push(entries)
  }
  for (const custom of listOf(valueAt(domains, "EquivalentDomains")))
    pushGroup(custom)
  for (const global of listOf(valueAt(domains, "GlobalEquivalentDomains"))) {
    if (valueAt(global, "Excluded") === true) continue
    pushGroup(valueAt(global, "Domains"))
  }
  return groups
}

/** Normalizes text for accent-insensitive search by stripping Unicode NFD combining diacritics. */
export function foldSearchText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
}

/** Whether a text contains every word of the query, ignoring case and diacritics. */
export function textMatchesQuery(text: string, query: string): boolean {
  const words = foldSearchText(query).split(/\s+/).filter(Boolean)
  const foldedText = foldSearchText(text)
  return words.length > 0 && words.every((word) => foldedText.includes(word))
}

/** Whether the item's name, username, addresses, folder, notes or custom fields match every word. */
export function matchesQuery(
  item: LoginItem,
  query: string,
  folderName = "",
): boolean {
  const text = [
    item.name,
    item.username,
    ...item.uris.map(({ uri }) => uri),
    folderName,
    item.searchableText ?? "",
  ]
  return textMatchesQuery(text.join("\n"), query)
}

/** A saved custom field, or null for one of a kind this code does not read. */
export function decryptCustomField(
  field: unknown,
  keys: VaultKeys,
  key: Uint8Array,
): CustomField | null {
  const name = keys.decrypt(valueAt(field, "Name"), key)
  const value = () => keys.decrypt(valueAt(field, "Value"), key)
  switch (valueAt(field, "Type")) {
    case FIELD_TEXT:
      return { kind: "text", name, value: value() }
    case FIELD_HIDDEN:
      return { kind: "hidden", name, value: value() }
    case FIELD_BOOLEAN:
      return { kind: "checkbox", name, checked: value() === "true" }
    case FIELD_LINKED: {
      const linkedId = valueAt(field, "LinkedId")
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
  const login = objectAt(cipher, "Login")
  const customFields = listOf(valueAt(cipher, "Fields"))
    .map((field) => decryptCustomField(field, keys, key))
    .filter((field) => field !== null)
  return {
    notes: keys.decrypt(valueAt(cipher, "Notes"), key),
    customFields,
    pastPasswordCount: listOf(valueAt(cipher, "PasswordHistory")).length,
    created: timeOf(valueAt(cipher, "CreationDate")),
    modified: timeOf(valueAt(cipher, "RevisionDate")),
    passwordModified: timeOf(valueAt(login, "PasswordRevisionDate")),
    hasPasskey: listOf(valueAt(login, "Fido2Credentials")).length > 0,
  }
}

/** The item's earlier passwords, newest first, as Bitwarden's apps keep them. */
export function decryptPasswordHistory(
  cipher: Record<string, unknown>,
  keys: VaultKeys,
): PastPassword[] {
  const key = keys.forCipher(cipher)
  const history = listOf(valueAt(cipher, "PasswordHistory")).map((entry) => ({
    password: keys.decrypt(valueAt(entry, "Password"), key),
    replaced: timeOf(valueAt(entry, "LastUsedDate")),
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
    valueAt(objectAt(cipher, "Login"), "Totp"),
    keys.forCipher(cipher),
  )
}

export function decryptPassword(
  cipher: Record<string, unknown>,
  keys: VaultKeys,
): string {
  return keys.decrypt(
    valueAt(objectAt(cipher, "Login"), "Password"),
    keys.forCipher(cipher),
  )
}

/** Decrypts a Bitwarden cipher's `Login.Fido2Credentials` list into usable passkey records. */
export function decryptFido2Credentials(
  cipher: Record<string, unknown>,
  keys: VaultKeys,
): StoredPasskey[] {
  const login = objectAt(cipher, "Login")
  const rawList = listOf(valueAt(login, "Fido2Credentials"))
  if (!rawList.length) return []
  const key = keys.forCipher(cipher)
  const readField = (entry: unknown, name: string): string => {
    const raw = valueAt(entry, name)
    if (typeof raw !== "string" || !raw) return ""
    try {
      return keys.decrypt(raw, key)
    } catch {
      return ""
    }
  }
  const result: StoredPasskey[] = []
  for (const entry of rawList) {
    const credentialId = readField(entry, "CredentialId")
    const keyValue = readField(entry, "KeyValue")
    const rpId = readField(entry, "RpId")
    if (!credentialId || !keyValue || !rpId) continue
    const creationRaw = valueAt(entry, "CreationDate")
    const discoverableRaw = readField(entry, "Discoverable")
    result.push({
      credentialId,
      keyType: readField(entry, "KeyType") || "public-key",
      keyAlgorithm: readField(entry, "KeyAlgorithm") || "ECDSA",
      keyCurve: readField(entry, "KeyCurve") || "P-256",
      keyValue,
      rpId,
      rpName: readField(entry, "RpName") || rpId,
      userHandle: readField(entry, "UserHandle"),
      userName: readField(entry, "UserName"),
      userDisplayName: readField(entry, "UserDisplayName"),
      counter: readField(entry, "Counter") || "0",
      discoverable: discoverableRaw === "false" ? "false" : "true",
      creationDate:
        typeof creationRaw === "string" && creationRaw
          ? creationRaw
          : new Date().toISOString(),
    })
  }
  return result
}

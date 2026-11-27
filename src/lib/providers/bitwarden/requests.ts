import type { CustomField, EditableNote, Website } from "@/lib/providers/types"
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
  MAX_PASSWORD_HISTORY,
  REPROMPT_NONE,
  REPROMPT_PASSWORD,
  SECURE_NOTE_TYPE_GENERIC,
} from "./cipher-types"
import { decryptCustomField } from "./decrypt"
import type { VaultKeys } from "./keys"

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
  reprompt?: boolean
  organizationId?: string | null
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
  folderId?: string | null
  reprompt?: boolean
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

function keyForOwner(
  keys: VaultKeys,
  organizationId: string | null | undefined,
): Uint8Array {
  if (!organizationId) return keys.userKey
  const orgKey = keys.forOrganization(organizationId)
  if (!orgKey) throw new Error(`Missing key for organization ${organizationId}`)
  return orgKey
}

/** The request body for a new login item, encrypted with the account or organization key. */
export function newLoginRequest(
  login: NewLoginFields,
  keys: VaultKeys,
  userId: string,
): Record<string, unknown> {
  const organizationId = login.organizationId ?? null
  const key = keyForOwner(keys, organizationId)
  return {
    type: CIPHER_TYPE_LOGIN,
    encryptedFor: userId,
    folderId: login.folderId ?? null,
    organizationId,
    name: keys.encrypt(login.name, key),
    notes: keys.encrypt(login.notes ?? "", key),
    favorite: false,
    reprompt: login.reprompt ? REPROMPT_PASSWORD : REPROMPT_NONE,
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

/** The request body for a new secure note, encrypted with the account or organization key. */
export function newNoteRequest(
  note: EditableNote,
  keys: VaultKeys,
  userId: string,
): Record<string, unknown> {
  const organizationId = note.organizationId ?? null
  const key = keyForOwner(keys, organizationId)
  return {
    type: CIPHER_TYPE_SECURE_NOTE,
    encryptedFor: userId,
    folderId: note.folderId ?? null,
    organizationId,
    name: keys.encrypt(note.name, key),
    notes: keys.encrypt(note.text, key),
    favorite: false,
    reprompt: note.reprompt ? REPROMPT_PASSWORD : REPROMPT_NONE,
    key: null,
    fields: note.customFields.map((field) =>
      encryptCustomField(field, keys, key),
    ),
    secureNote: { type: SECURE_NOTE_TYPE_GENERIC },
  }
}

/** A saved custom field, as stored and as read; null for a field of a kind this code does not read. */
interface SavedField {
  stored: unknown
  read: CustomField | null
}

function savedFieldRequest(field: unknown): Record<string, unknown> {
  return {
    type: valueAt(field, "Type"),
    name: valueAt(field, "Name"),
    value: valueAt(field, "Value"),
    linkedId: valueAt(field, "LinkedId") ?? null,
  }
}

/**
 * The item's custom fields for a request. A field this code cannot read is kept as saved, so an
 * edit never drops it.
 */
function customFieldsRequest(
  saved: SavedField[],
  next: CustomField[] | undefined,
  keys: VaultKeys,
  key: Uint8Array,
): Record<string, unknown>[] {
  if (next === undefined)
    return saved.map(({ stored }) => savedFieldRequest(stored))
  return [
    ...next.map((field) => encryptCustomField(field, keys, key)),
    ...saved
      .filter(({ read }) => read === null)
      .map(({ stored }) => savedFieldRequest(stored)),
  ]
}

/**
 * Hidden fields whose value the change replaces or removes. Bitwarden's apps keep their old values in
 * the password history as "name: value", so a secret never goes away unnoticed.
 */
function replacedHiddenValues(
  saved: SavedField[],
  next: CustomField[] | undefined,
): string[] {
  if (next === undefined) return []
  return saved.flatMap(({ read: field }) => {
    if (field?.kind !== "hidden" || !field.name || !field.value) return []
    const stillThere = next.some(
      (candidate) =>
        candidate.kind === "hidden" &&
        candidate.name === field.name &&
        candidate.value === field.value,
    )
    return stillThere ? [] : [`${field.name}: ${field.value}`]
  })
}

/**
 * The item's password history for a request: the replaced password and hidden values first, then
 * the saved entries, as many as Bitwarden's apps keep. The entries stay encrypted.
 */
function passwordHistoryRequest(
  cipher: Record<string, unknown>,
  replacedValues: string[],
  now: string,
): Record<string, unknown>[] | null {
  const kept = listOf(valueAt(cipher, "PasswordHistory")).map((entry) => ({
    password: valueAt(entry, "Password"),
    lastUsedDate: valueAt(entry, "LastUsedDate"),
  }))
  const replaced = replacedValues.map((password) => ({
    password,
    lastUsedDate: now,
  }))
  const history = replaced.length
    ? [...replaced, ...kept].slice(0, MAX_PASSWORD_HISTORY)
    : kept
  return history.length ? history : null
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
  const current = listOf(saved).map((savedUri) => ({
    uri: valueAt(savedUri, "Uri") ?? null,
    match: valueAt(savedUri, "Match") ?? null,
    uriChecksum: valueAt(savedUri, "UriChecksum") ?? null,
  }))
  if (next === undefined) return current
  const byText = new Map(
    current.map((savedUri) => [keys.decrypt(savedUri.uri, key), savedUri]),
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
  const login = objectAt(cipher, "Login")
  /** The field's new value encrypted, or the saved one when the change leaves it out. */
  const changed = (value: string | undefined, saved: unknown) =>
    value === undefined ? (saved ?? null) : keys.encrypt(value, key)
  const now = new Date().toISOString()
  const savedFields = listOf(valueAt(cipher, "Fields")).map((stored) => ({
    stored,
    read: decryptCustomField(stored, keys, key),
  }))
  const oldPassword = valueAt(login, "Password")
  const replacedPassword =
    change.password !== undefined &&
    typeof oldPassword === "string" &&
    oldPassword
      ? [oldPassword]
      : []
  const replacedFields = replacedHiddenValues(
    savedFields,
    change.customFields,
  ).flatMap((text) => keys.encrypt(text, key) ?? [])
  let reprompt = valueAt(cipher, "Reprompt") ?? REPROMPT_NONE
  if (change.reprompt !== undefined)
    reprompt = change.reprompt ? REPROMPT_PASSWORD : REPROMPT_NONE
  const common = {
    encryptedFor: userId,
    folderId:
      change.folderId !== undefined
        ? change.folderId
        : (valueAt(cipher, "FolderId") ?? null),
    organizationId: valueAt(cipher, "OrganizationId") ?? null,
    name: changed(change.name, valueAt(cipher, "Name")),
    notes: changed(change.notes, valueAt(cipher, "Notes")),
    favorite: valueAt(cipher, "Favorite") ?? false,
    reprompt,
    key: valueAt(cipher, "Key") ?? null,
    lastKnownRevisionDate: valueAt(cipher, "RevisionDate") ?? null,
    fields: customFieldsRequest(savedFields, change.customFields, keys, key),
    passwordHistory: passwordHistoryRequest(
      cipher,
      [...replacedPassword, ...replacedFields],
      now,
    ),
  }
  if (valueAt(cipher, "Type") === CIPHER_TYPE_SECURE_NOTE) {
    return {
      type: CIPHER_TYPE_SECURE_NOTE,
      ...common,
      secureNote: {
        type:
          valueAt(objectAt(cipher, "SecureNote"), "Type") ??
          SECURE_NOTE_TYPE_GENERIC,
      },
    }
  }
  return {
    type: CIPHER_TYPE_LOGIN,
    ...common,
    login: {
      username: changed(change.username, valueAt(login, "Username")),
      password: changed(change.password, oldPassword),
      passwordRevisionDate:
        change.password === undefined
          ? (valueAt(login, "PasswordRevisionDate") ?? null)
          : now,
      totp: changed(change.totp, valueAt(login, "Totp")),
      autofillOnPageLoad: valueAt(login, "AutofillOnPageLoad") ?? null,
      fido2Credentials: valueAt(login, "Fido2Credentials") ?? null,
      uris: await urisRequest(valueAt(login, "Uris"), change.uris, keys, key),
    },
  }
}

/**
 * Builds a create-cipher request cloning an existing login or note, stripping passkeys and
 * password history and keeping the same owner key.
 */
export function cloneCipherRequest(
  cipher: Record<string, unknown>,
  keys: VaultKeys,
  userId: string,
  cloneName: string,
): Record<string, unknown> {
  const organizationId = valueAt(cipher, "OrganizationId")
  const ownerOrgId =
    typeof organizationId === "string" && organizationId ? organizationId : null
  const sourceKey = keys.forCipher(cipher)
  const targetKey = keyForOwner(keys, ownerOrgId)
  const reencrypt = (raw: unknown): string | null => {
    const plain = keys.decrypt(raw, sourceKey)
    return keys.encrypt(plain, targetKey)
  }
  const fields = listOf(valueAt(cipher, "Fields"))
    .map((field) => decryptCustomField(field, keys, sourceKey))
    .filter((field) => field !== null)
    .map((field) => encryptCustomField(field, keys, targetKey))

  const common = {
    encryptedFor: userId,
    folderId: valueAt(cipher, "FolderId") ?? null,
    organizationId: ownerOrgId,
    name: keys.encrypt(cloneName, targetKey),
    notes: reencrypt(valueAt(cipher, "Notes")),
    favorite: false,
    reprompt: valueAt(cipher, "Reprompt") ?? REPROMPT_NONE,
    key: null,
    fields,
  }

  if (valueAt(cipher, "Type") === CIPHER_TYPE_SECURE_NOTE) {
    return {
      type: CIPHER_TYPE_SECURE_NOTE,
      ...common,
      secureNote: {
        type:
          valueAt(objectAt(cipher, "SecureNote"), "Type") ??
          SECURE_NOTE_TYPE_GENERIC,
      },
    }
  }
  const login = objectAt(cipher, "Login")
  return {
    type: CIPHER_TYPE_LOGIN,
    ...common,
    login: {
      username: reencrypt(valueAt(login, "Username")),
      password: reencrypt(valueAt(login, "Password")),
      totp: reencrypt(valueAt(login, "Totp")),
      uris: listOf(valueAt(login, "Uris")).map((entry) => ({
        uri: reencrypt(valueAt(entry, "Uri")),
        match: valueAt(entry, "Match") ?? null,
      })),
    },
  }
}

import { oneTimeCode } from "@/lib/totp"
import {
  type CustomField,
  type EditableLogin,
  type EditableNote,
  type FillField,
  type LoginEdit,
  type LoginSummary,
  type NoteSummary,
  VaultError,
  type VaultGroups,
} from "../types"
import type { StoredAccount } from "./account-store"
import { type BitwardenApi, valueAt } from "./api"
import { REPROMPT_PASSWORD } from "./cipher-types"
import {
  decryptDetails,
  decryptPassword,
  decryptTotp,
  firstHostOf,
  type LoginItem,
  type NoteItem,
} from "./decrypt"
import type { VaultKeys } from "./keys"
import type { RepromptItem } from "./reprompt-passes"
import type { ItemChange } from "./requests"
import { serverHost } from "./server"

/** Verifies `folderId` exists in `groups` when non-null; returns it unchanged. */
export function requireFolder(
  groups: VaultGroups,
  folderId: string | null,
): string | null {
  if (folderId && !groups.folders.some((folder) => folder.id === folderId))
    throw new VaultError("Unknown folder", "notFound")
  return folderId
}

/** Sends a cipher creation request to either the organization or personal endpoint. */
export function createOwnedCipher(
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
export function accountLabel(
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

export function summaryOf(item: LoginItem): LoginSummary {
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

export function noteSummaryOf(note: NoteItem): NoteSummary {
  return {
    id: note.id,
    name: note.name,
    grouping: note.grouping,
    favorite: note.favorite,
  }
}

export function editableLoginOf(
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

export function editableNoteOf(
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

export function checkedCollections(
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
export function sameValues(first: unknown, second: unknown): boolean {
  return JSON.stringify(first) === JSON.stringify(second)
}

/** The fields of an edit that differ from the login as it is saved. */
export function loginChanges(
  current: EditableLogin,
  change: LoginEdit,
): ItemChange {
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

export function unreadableCodeKey(): VaultError {
  return new VaultError(
    "The authenticator key cannot be read",
    "invalidCodeKey",
  )
}

export function requireCodeKey(key: string): void {
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
export function isEditable(
  item: Pick<RepromptItem, "reprompt">,
  cipher: Record<string, unknown>,
): boolean {
  return (
    !item.reprompt &&
    !valueAt(cipher, "DeletedDate") &&
    valueAt(cipher, "Edit") !== false
  )
}

export function refuseEdit(
  item: Pick<RepromptItem, "reprompt">,
  cipher: Record<string, unknown>,
): void {
  refuseReprompt(item)
  if (!isEditable(item, cipher))
    throw new VaultError("The login cannot be changed", "notEditable")
}

/** Items marked for master password re-prompt are left to Bitwarden's own apps. */
export function refuseReprompt(item: Pick<RepromptItem, "reprompt">): void {
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
export function fillFields(
  customFields: readonly CustomField[],
  login: { username: string; password: string },
): FillField[] {
  return customFields
    .filter((field) => field.name !== "")
    .map((field) => fillFieldOf(field, login))
}

import type { GeneratorKind } from "@/lib/generator"
import {
  type CustomEndpoints,
  normalizeServerAddress,
} from "@/lib/providers/bitwarden/server"
import {
  type CustomField,
  type EditableNote,
  type LoginEdit,
  type NewLoginDetails,
  VaultError,
  type Website,
} from "@/lib/providers/types"
import { MatchType } from "@/lib/settings"
import type { FieldKind } from "../api"

export function requireText(
  value: unknown,
  name: string,
  maxLength = 1024,
): string {
  if (typeof value !== "string" || value.length > maxLength) {
    throw new VaultError(`Invalid ${name}`, "invalidInput")
  }
  return value
}

/** Checks a self-hosted server's separate endpoints; none given leaves them to follow its address. */
export function customEndpointsOf(value: unknown): CustomEndpoints | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== "object")
    throw new VaultError("Invalid endpoints", "invalidInput")
  const { api, identity } = value as Record<string, unknown>
  const endpoints: CustomEndpoints = {}
  const checkedApi = normalizeServerAddress(requireText(api ?? "", "api"))
  const checkedIdentity = normalizeServerAddress(
    requireText(identity ?? "", "identity"),
  )
  if (checkedApi) endpoints.api = checkedApi
  if (checkedIdentity) endpoints.identity = checkedIdentity
  return checkedApi || checkedIdentity ? endpoints : undefined
}

const MAX_URIS = 50

/** The fields of an edit, checked; fields that are left out stay out. */
export function loginEdit(value: unknown): LoginEdit {
  if (typeof value !== "object" || value === null)
    throw new VaultError("Invalid change", "invalidInput")
  const input = value as Record<string, unknown>
  const edit: LoginEdit = {}
  const limits = {
    name: 1024,
    username: 1024,
    password: 1024,
    notes: 10_000,
    totp: 4096,
  } as const
  for (const [key, max] of Object.entries(limits) as [
    keyof typeof limits,
    number,
  ][]) {
    if (input[key] !== undefined) edit[key] = requireText(input[key], key, max)
  }
  if (input.uris !== undefined) {
    if (!Array.isArray(input.uris) || input.uris.length > MAX_URIS)
      throw new VaultError("Invalid addresses", "invalidInput")
    edit.uris = input.uris.map(websiteInput)
  }
  if (input.customFields !== undefined)
    edit.customFields = customFieldsInput(input.customFields)
  return edit
}

const MATCH_TYPES: readonly unknown[] = Object.values(MatchType)

function websiteInput(value: unknown): Website {
  const { uri, match } = (value ?? {}) as Record<string, unknown>
  if (match !== null && !MATCH_TYPES.includes(match))
    throw new VaultError("Invalid match", "invalidInput")
  return {
    uri: requireText(uri, "uri", 2048),
    match: match as Website["match"],
  }
}

/** Bitwarden stores up to 10,000 characters of notes. */
const MAX_NOTE_LENGTH = 10_000

export function noteInput(value: unknown): EditableNote {
  if (typeof value !== "object" || value === null)
    throw new VaultError("Invalid note", "invalidInput")
  const input = value as Record<string, unknown>
  const name = requireText(input.name, "name").trim()
  if (!name) throw new VaultError("The note needs a name", "invalidInput")
  return {
    name,
    text: requireText(input.text, "text", MAX_NOTE_LENGTH),
    customFields: customFieldsInput(input.customFields),
  }
}

const MAX_CUSTOM_FIELDS = 100

/** The rest of a new login, checked; none given leaves the login to its site, username and password. */
export function newLoginDetailsInput(
  value: unknown,
): NewLoginDetails | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== "object")
    throw new VaultError("Invalid login", "invalidInput")
  const input = value as Record<string, unknown>
  const folderId = input.folderId ?? null
  return {
    name: requireText(input.name ?? "", "name"),
    notes: requireText(input.notes ?? "", "notes", MAX_NOTE_LENGTH),
    totp: requireText(input.totp ?? "", "totp", 4096),
    customFields: customFieldsInput(input.customFields ?? []),
    folderId: folderId === null ? null : requireText(folderId, "folderId", 64),
  }
}

function customFieldsInput(value: unknown): CustomField[] {
  if (!Array.isArray(value) || value.length > MAX_CUSTOM_FIELDS)
    throw new VaultError("Invalid custom fields", "invalidInput")
  return value.map(customFieldInput)
}

function customFieldInput(value: unknown): CustomField {
  const invalid = new VaultError("Invalid custom field", "invalidInput")
  if (typeof value !== "object" || value === null) throw invalid
  const field = value as Record<string, unknown>
  const name = requireText(field.name, "field name")
  switch (field.kind) {
    case "text":
    case "hidden":
      return {
        kind: field.kind,
        name,
        value: requireText(field.value, "field value", 5000),
      }
    case "checkbox":
      if (typeof field.checked !== "boolean") throw invalid
      return { kind: "checkbox", name, checked: field.checked }
    case "linked":
      if (field.linkedTo !== "username" && field.linkedTo !== "password")
        throw invalid
      return { kind: "linked", name, linkedTo: field.linkedTo }
    default:
      throw invalid
  }
}

export function generatorKind(value: unknown): GeneratorKind {
  if (value !== "password" && value !== "passphrase" && value !== "username")
    throw new VaultError("Invalid generator kind", "invalidInput")
  return value
}

export function fieldKind(value: unknown): FieldKind {
  if (value !== "login" && value !== "code")
    throw new VaultError("Invalid field kind", "invalidInput")
  return value
}

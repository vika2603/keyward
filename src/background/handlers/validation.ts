import type { GeneratorKind } from "@/lib/generator"
import type { SecondStepMethod } from "@/lib/providers/bitwarden/auth"
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
import {
  MAX_CUSTOM_FIELD_VALUE_LENGTH,
  MAX_CUSTOM_FIELDS,
  MAX_FOLDER_ID_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_TEXT_LENGTH,
  MAX_TOTP_LENGTH,
  MAX_URL_LENGTH,
  MAX_WEBSITES,
} from "../limits"

function invalid(name: string): VaultError {
  return new VaultError(`Invalid ${name}`, "invalidInput")
}

export function requireText(
  value: unknown,
  name: string,
  maxLength = MAX_TEXT_LENGTH,
): string {
  if (typeof value !== "string" || value.length > maxLength) throw invalid(name)
  return value
}

export function requireBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw invalid(name)
  return value
}

export function requireFiniteNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw invalid(name)
  return value
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null) throw invalid(name)
  return value as Record<string, unknown>
}

/** A text a request may leave out; none given, or null, reads as null. */
export function optionalText(
  value: unknown,
  name: string,
  maxLength = MAX_TEXT_LENGTH,
): string | null {
  return value === undefined || value === null
    ? null
    : requireText(value, name, maxLength)
}

/** A folder to file an item in; none given, or null, is no folder. */
export function optionalFolderId(value: unknown): string | null {
  return optionalText(value, "folderId", MAX_FOLDER_ID_LENGTH)
}

/** Checks a self-hosted server's separate endpoints; none given leaves them to follow its address. */
export function customEndpointsOf(value: unknown): CustomEndpoints | undefined {
  if (value === undefined || value === null) return undefined
  const { api, identity } = requireRecord(value, "endpoints")
  const endpoints: CustomEndpoints = {}
  const checkedApi = normalizeServerAddress(requireText(api ?? "", "api"))
  const checkedIdentity = normalizeServerAddress(
    requireText(identity ?? "", "identity"),
  )
  if (checkedApi) endpoints.api = checkedApi
  if (checkedIdentity) endpoints.identity = checkedIdentity
  return checkedApi || checkedIdentity ? endpoints : undefined
}

const LOGIN_EDIT_TEXT_LIMITS = {
  name: MAX_TEXT_LENGTH,
  username: MAX_TEXT_LENGTH,
  password: MAX_TEXT_LENGTH,
  notes: MAX_NOTE_LENGTH,
  totp: MAX_TOTP_LENGTH,
} as const

/** The fields of an edit, checked; fields that are left out stay out. */
export function loginEdit(value: unknown): LoginEdit {
  const input = requireRecord(value, "change")
  const edit: LoginEdit = {}
  for (const [key, maxLength] of Object.entries(LOGIN_EDIT_TEXT_LIMITS) as [
    keyof typeof LOGIN_EDIT_TEXT_LIMITS,
    number,
  ][]) {
    if (input[key] !== undefined)
      edit[key] = requireText(input[key], key, maxLength)
  }
  if (input.uris !== undefined) {
    if (!Array.isArray(input.uris) || input.uris.length > MAX_WEBSITES)
      throw invalid("addresses")
    edit.uris = input.uris.map(websiteInput)
  }
  if (input.customFields !== undefined)
    edit.customFields = customFieldsInput(input.customFields)
  return edit
}

const MATCH_TYPES: readonly unknown[] = Object.values(MatchType)

function websiteInput(value: unknown): Website {
  const { uri, match } = requireRecord(value, "address")
  if (match !== null && !MATCH_TYPES.includes(match)) throw invalid("match")
  return {
    uri: requireText(uri, "uri", MAX_URL_LENGTH),
    match: match as Website["match"],
  }
}

export function noteInput(value: unknown): EditableNote {
  const input = requireRecord(value, "note")
  const name = requireText(input.name, "name").trim()
  if (!name) throw new VaultError("The note needs a name", "invalidInput")
  return {
    name,
    text: requireText(input.text, "text", MAX_NOTE_LENGTH),
    customFields: customFieldsInput(input.customFields),
  }
}

/** The rest of a new login, checked; none given leaves the login to its site, username and password. */
export function newLoginDetailsInput(
  value: unknown,
): NewLoginDetails | undefined {
  if (value === undefined || value === null) return undefined
  const input = requireRecord(value, "login")
  return {
    name: requireText(input.name ?? "", "name"),
    notes: requireText(input.notes ?? "", "notes", MAX_NOTE_LENGTH),
    totp: requireText(input.totp ?? "", "totp", MAX_TOTP_LENGTH),
    customFields: customFieldsInput(input.customFields ?? []),
    folderId: optionalFolderId(input.folderId),
  }
}

function customFieldsInput(value: unknown): CustomField[] {
  if (!Array.isArray(value) || value.length > MAX_CUSTOM_FIELDS)
    throw invalid("custom fields")
  return value.map(customFieldInput)
}

function customFieldInput(value: unknown): CustomField {
  const field = requireRecord(value, "custom field")
  const name = requireText(field.name, "field name")
  switch (field.kind) {
    case "text":
    case "hidden":
      return {
        kind: field.kind,
        name,
        value: requireText(
          field.value,
          "field value",
          MAX_CUSTOM_FIELD_VALUE_LENGTH,
        ),
      }
    case "checkbox":
      return {
        kind: "checkbox",
        name,
        checked: requireBoolean(field.checked, "custom field"),
      }
    case "linked":
      if (field.linkedTo !== "username" && field.linkedTo !== "password")
        throw invalid("custom field")
      return { kind: "linked", name, linkedTo: field.linkedTo }
    default:
      throw invalid("custom field")
  }
}

export function generatorKind(value: unknown): GeneratorKind {
  if (value !== "password" && value !== "passphrase" && value !== "username")
    throw invalid("generator kind")
  return value
}

export function fieldKind(value: unknown): FieldKind {
  if (value !== "login" && value !== "code") throw invalid("field kind")
  return value
}

const SECOND_STEP_METHODS: readonly unknown[] = [
  "authenticator",
  "email",
  "recoveryCode",
  "newDevice",
] satisfies SecondStepMethod[]

export function secondStepMethod(value: unknown): SecondStepMethod {
  if (!SECOND_STEP_METHODS.includes(value)) throw invalid("method")
  return value as SecondStepMethod
}

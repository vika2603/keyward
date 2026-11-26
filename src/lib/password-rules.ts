/**
 * Password rules in the format of the HTML `passwordrules` attribute, which Apple's list of
 * websites' rules in password-manager-resources also uses: https://developer.apple.com/password-rules/
 */

import { DIGITS, LOWER, type PasswordLimits, SPECIAL, UPPER } from "./generator"
import appleRules from "./site-data/apple-password-rules.json"

/** What a page's new-password field sets for a password, as the page writes it. */
export interface FieldRules {
  /** The field's `passwordrules` attribute. */
  rules: string | null
  minLength: number | null
  maxLength: number | null
}

/** Longer rules texts are not read; the longest in Apple's list has about 200 characters. */
const MAX_RULES_LENGTH = 1024

/**
 * Field rules as a content script reads them from a page. The page sets them, so a malformed part
 * is left out rather than refused.
 */
export function fieldRulesFrom(value: unknown): FieldRules | null {
  if (typeof value !== "object" || value === null) return null
  const { rules, minLength, maxLength } = value as Record<string, unknown>
  const length = (candidate: unknown) =>
    typeof candidate === "number" &&
    Number.isInteger(candidate) &&
    candidate > 0
      ? candidate
      : null
  return {
    rules:
      typeof rules === "string" && rules.length <= MAX_RULES_LENGTH
        ? rules
        : null,
    minLength: length(minLength),
    maxLength: length(maxLength),
  }
}

const PRINTABLE = UPPER + LOWER + DIGITS + SPECIAL
/** The named character classes; Keyward generates no characters beyond printable ASCII. */
const NAMED_CLASSES: Record<string, string> = {
  upper: UPPER,
  lower: LOWER,
  digit: DIGITS,
  special: SPECIAL,
  "ascii-printable": PRINTABLE,
  unicode: PRINTABLE,
}
const siteRules: Record<string, { "password-rules": string }> = appleRules

function unique(characters: string): string {
  return [...new Set(characters)].join("")
}

/**
 * The end, exclusive, of a custom class that opens at `start`: just after the `]` that a `,`, a
 * `;` or the text's end follows. Another `]` is one of the class's characters, as in `[[]]`.
 */
function customClassEnd(text: string, start: number): number {
  const closing = /\]\s*(?=[,;]|$)/g
  closing.lastIndex = start + 1
  const match = closing.exec(text)
  return match ? match.index + 1 : text.length
}

/** The properties of a rules text in order, each with its comma-separated values. */
function properties(text: string): { name: string; values: string[] }[] {
  const found: { name: string; values: string[] }[] = []
  let position = 0
  while (position < text.length) {
    const colon = text.indexOf(":", position)
    if (colon < 0) break
    const name = text.slice(position, colon).trim().toLowerCase()
    const values: string[] = []
    let value = ""
    position = colon + 1
    while (position < text.length && text[position] !== ";") {
      const character = text[position] as string
      if (character === "[") {
        const end = customClassEnd(text, position)
        value += text.slice(position, end)
        position = end
        continue
      }
      if (character === ",") {
        values.push(value.trim())
        value = ""
      } else {
        value += character
      }
      position++
    }
    values.push(value.trim())
    found.push({ name, values: values.filter(Boolean) })
    position++
  }
  return found
}

/** The characters of a class: a name such as `digit`, or the characters listed in `[...]`. */
function classCharacters(value: string): string {
  if (!value.startsWith("[")) return NAMED_CLASSES[value.toLowerCase()] ?? ""
  const listed = value.slice(1, value.endsWith("]") ? -1 : undefined)
  return [...listed]
    .filter((character) => PRINTABLE.includes(character))
    .join("")
}

/**
 * The limits a rules text sets, or null when it sets none Keyward understands. Repeated limits
 * combine to the strictest, and required characters are allowed too, as the format defines.
 */
export function parsePasswordRules(text: string): PasswordLimits | null {
  const limits: PasswordLimits = {
    minLength: null,
    maxLength: null,
    maxConsecutive: null,
    required: [],
    allowed: null,
  }
  let allowed = ""
  let understood = false
  for (const { name, values } of properties(text)) {
    const number = /^\d+$/.test(values[0] ?? "") ? Number(values[0]) : null
    if (name === "minlength" && number !== null) {
      limits.minLength = Math.max(limits.minLength ?? 0, number)
    } else if (name === "maxlength" && number) {
      limits.maxLength = Math.min(limits.maxLength ?? number, number)
    } else if (name === "max-consecutive" && number) {
      limits.maxConsecutive = Math.min(limits.maxConsecutive ?? number, number)
    } else if (name === "required" || name === "allowed") {
      const characters = unique(values.map(classCharacters).join(""))
      if (!characters) continue
      if (name === "required") limits.required.push(characters)
      allowed += characters
    } else {
      continue
    }
    understood = true
  }
  if (!understood) return null
  limits.allowed = allowed ? unique(allowed) : null
  return limits
}

/** Apple's rules for a host, or for the nearest parent domain it lists rules for. */
export function siteRulesFor(host: string): string | null {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".")
  for (let start = 0; start < labels.length - 1; start++) {
    const domain = labels.slice(start).join(".")
    if (Object.hasOwn(siteRules, domain))
      return siteRules[domain]?.["password-rules"] ?? null
  }
  return null
}

function smallest(...values: (number | null | undefined)[]): number | null {
  const set = values.filter((value) => typeof value === "number")
  return set.length ? Math.min(...set) : null
}

function largest(...values: (number | null | undefined)[]): number | null {
  const set = values.filter((value) => typeof value === "number")
  return set.length ? Math.max(...set) : null
}

/**
 * What a password generated for a page's field keeps to: the field's own rules, else Apple's rules
 * for the site, within the field's length limits. Null when none of them sets anything.
 */
export function passwordLimitsFor(
  host: string,
  field: FieldRules | null,
): PasswordLimits | null {
  const rules =
    parsePasswordRules(field?.rules ?? "") ??
    parsePasswordRules(siteRulesFor(host) ?? "")
  const minLength = largest(rules?.minLength, field?.minLength)
  const maxLength = smallest(rules?.maxLength, field?.maxLength)
  if (!rules && minLength === null && maxLength === null) return null
  return {
    maxConsecutive: rules?.maxConsecutive ?? null,
    required: rules?.required ?? [],
    allowed: rules?.allowed ?? null,
    minLength,
    maxLength,
  }
}

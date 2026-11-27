import { ZxcvbnFactory } from "@zxcvbn-ts/core"
import * as languageCommon from "@zxcvbn-ts/language-common"
import { VaultError } from "./providers/types"

/** Passwords longer than this are truncated before zxcvbn analysis to avoid quadratic work. */
export const MAX_STRENGTH_INPUT_LENGTH = 256

export type StrengthScore = 0 | 1 | 2 | 3 | 4
export type StrengthLevel = "weak" | "fair" | "good" | "strong"

export interface PasswordStrength {
  score: StrengthScore
  level: StrengthLevel
}

let analyzer: ZxcvbnFactory | null = null

function zxcvbnAnalyzer(): ZxcvbnFactory {
  analyzer ??= new ZxcvbnFactory({
    graphs: languageCommon.adjacencyGraphs,
    dictionary: { ...languageCommon.dictionary },
  })
  return analyzer
}

/** Evaluates password strength locally with zxcvbn (truncated to 256 characters). */
export function evaluatePasswordStrength(
  password: string,
  userInputs: readonly string[] = [],
): PasswordStrength {
  if (!password) return { score: 0, level: "weak" }
  const truncated = password.slice(0, MAX_STRENGTH_INPUT_LENGTH)
  const inputs = userInputs
    .map((value) => value.trim())
    .filter((value) => value.length >= 2)
    .slice(0, 10)
  const result = zxcvbnAnalyzer().check(truncated, inputs)
  const score = result.score as StrengthScore
  let level: StrengthLevel = "weak"
  if (score === 2) level = "fair"
  else if (score === 3) level = "good"
  else if (score >= 4) level = "strong"
  return { score, level }
}

async function sha1HexUpper(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest("SHA-1", bytes)
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  )
    .join("")
    .toUpperCase()
}

/**
 * Checks whether `password` appears in Have I Been Pwned using k-anonymity: sends only the first
 * 5 uppercase SHA-1 hex characters with `Add-Padding: true` and matches the remaining 35 locally.
 * Returns the breach occurrence count (0 when not found).
 */
export async function checkPasswordBreach(password: string): Promise<number> {
  if (!password) return 0
  const hash = await sha1HexUpper(password)
  const prefix = hash.slice(0, 5)
  const suffix = hash.slice(5)
  let response: Response
  try {
    response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      method: "GET",
      headers: { "Add-Padding": "true" },
      cache: "no-store",
      credentials: "omit",
    })
  } catch (error) {
    throw new VaultError(
      "Could not reach the breach check service",
      "network",
      {
        cause: error,
      },
    )
  }
  if (!response.ok)
    throw new VaultError(
      `Breach check responded with status ${response.status}`,
      "network",
    )
  const body = await response.text()
  for (const line of body.split(/\r?\n/)) {
    const [candidate, countText] = line.trim().split(":")
    if (!candidate || !countText) continue
    if (candidate.toUpperCase() === suffix) {
      const count = Number.parseInt(countText, 10)
      return Number.isFinite(count) && count > 0 ? count : 0
    }
  }
  return 0
}

/** Standard /.well-known/change-password URL for a site host, or null for non-web hosts. */
export function changePasswordUrlFor(host: string | undefined): string | null {
  const trimmed = host?.trim()
  if (!trimmed) return null
  try {
    const url = new URL(`https://${trimmed}/.well-known/change-password`)
    return url.href
  } catch {
    return null
  }
}

/** Whether a saved URI uses unencrypted HTTP on a non-local host. */
export function isInsecureHttpUri(uri: string): boolean {
  const trimmed = uri.trim()
  if (!/^http:\/\//i.test(trimmed)) return false
  try {
    const { hostname } = new URL(trimmed)
    const lower = hostname.toLowerCase()
    if (
      lower === "localhost" ||
      lower.endsWith(".localhost") ||
      lower === "127.0.0.1" ||
      lower === "::1" ||
      lower === "[::1]"
    )
      return false
    return true
  } catch {
    return false
  }
}

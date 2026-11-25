import { HOTP, Secret, TOTP } from "otpauth"
import type { OneTimeCode } from "@/lib/providers/types"

/** Steam Guard's code alphabet; its codes are five of these characters. */
const STEAM_CHARS = "23456789BCDFGHJKMNPQRTVWXY"

function secretOf(base32: string): Secret {
  return Secret.fromBase32(base32.replace(/[\s=-]/g, "").toUpperCase())
}

/**
 * An `otpauth://totp/` key, read the way Bitwarden reads it: the label may be missing, digits
 * above 10 become 10, and values it does not know fall back to SHA-1, 6 digits and 30 seconds.
 */
function totpOfUri(uri: string): TOTP {
  const url = new URL(uri)
  if (url.hostname.toLowerCase() !== "totp")
    throw new Error("Only time-based codes are supported")
  const params = url.searchParams
  const secret = params.get("secret")
  if (!secret) throw new Error("The key has no secret")
  const digits = Number.parseInt(params.get("digits") ?? "", 10)
  const period = Number.parseInt(params.get("period") ?? "", 10)
  const algorithm = (params.get("algorithm") ?? "").toUpperCase()
  return new TOTP({
    secret: secretOf(secret),
    digits: digits > 0 ? Math.min(digits, 10) : 6,
    period: period > 0 ? period : 30,
    algorithm:
      algorithm === "SHA256" || algorithm === "SHA512" ? algorithm : "SHA1",
  })
}

function expiry(period: number, now: number): number {
  const ms = period * 1000
  return (Math.floor(now / ms) + 1) * ms
}

/**
 * The current code for a saved authenticator key, which Bitwarden stores as an `otpauth://`
 * URI, a `steam://` key or a bare base32 secret.
 */
/** Who an `otpauth://` key is for, as its label and issuer say; empty for other keys. */
export function keyLabel(key: string): { issuer?: string; account?: string } {
  let url: URL
  try {
    url = new URL(key.trim())
  } catch {
    return {}
  }
  if (url.protocol !== "otpauth:") return {}
  const label = decodeURIComponent(url.pathname.replace(/^\/+/, ""))
  const separator = label.indexOf(":")
  const account = (separator < 0 ? label : label.slice(separator + 1)).trim()
  const issuer = (
    url.searchParams.get("issuer") ??
    (separator < 0 ? "" : label.slice(0, separator))
  ).trim()
  return {
    ...(issuer ? { issuer } : {}),
    ...(account ? { account } : {}),
  }
}

export function oneTimeCode(
  key: string,
  now = Date.now(),
): Required<OneTimeCode> {
  const trimmed = key.trim()
  if (/^steam:\/\//i.test(trimmed)) {
    const period = 30
    // Ten digits keep the whole 31-bit value that Steam spells out in its own alphabet.
    let value = Number(
      HOTP.generate({
        secret: secretOf(trimmed.slice("steam://".length)),
        digits: 10,
        counter: Math.floor(now / 1000 / period),
      }),
    )
    let code = ""
    for (let i = 0; i < 5; i++) {
      code += STEAM_CHARS[value % STEAM_CHARS.length]
      value = Math.floor(value / STEAM_CHARS.length)
    }
    return { code, period, expiresAt: expiry(period, now) }
  }
  const totp = /^otpauth:\/\//i.test(trimmed)
    ? totpOfUri(trimmed)
    : new TOTP({ secret: secretOf(trimmed) })
  return {
    code: totp.generate({ timestamp: now }),
    period: totp.period,
    expiresAt: expiry(totp.period, now),
  }
}

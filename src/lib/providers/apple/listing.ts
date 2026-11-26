import { isHostOrSubdomain } from "@/lib/site"
import { VaultError } from "../types"
import { entriesOf } from "./protocol"

/** A listed login. */
export interface Entry {
  username: string
  /** The site the login is listed under. */
  site: string
  /** Every site the login is saved for. */
  sites: string[]
  customTitle?: string
}

/** An authenticator entry the helper offers codes for. */
export interface CodeEntry {
  username: string
  domain: string
}

/** The source of a code entry that comes from an authenticator key. */
export const TOTP_SOURCE = "totp"

/** Whether a site the helper returned may answer a request made for `host`. */
export function isSameSite(site: string, host: string): boolean {
  return isHostOrSubdomain(site, host) || isHostOrSubdomain(host, site)
}

/** A login's ID within the vault: its username and the site it is listed under. */
export function loginId(username: string, site: string): string {
  return JSON.stringify([username, site])
}

export function parseLoginId(id: string): { username: string; site: string } {
  let parsed: unknown = null
  try {
    parsed = JSON.parse(id)
  } catch {
    // Not one of the IDs `loginId` makes; reported as an unknown login below.
  }
  if (
    !Array.isArray(parsed) ||
    typeof parsed[0] !== "string" ||
    typeof parsed[1] !== "string"
  ) {
    throw new VaultError("Unknown login", "unknownLogin")
  }
  return { username: parsed[0], site: parsed[1] }
}

export function textOf(value: unknown): string {
  return typeof value === "string" ? value : ""
}

/** A listed login entry; the host it was listed for stands in for sites the entry leaves out. */
export function entryOf(entry: Record<string, unknown>, host: string): Entry {
  const sites = Array.isArray(entry.sites) ? entry.sites.map(String) : []
  return {
    username: textOf(entry.USR),
    site: sites[0] ?? host,
    sites: sites.length ? sites : [host],
    customTitle: textOf(entry.customTitle) || undefined,
  }
}

/** An entry of a code listing; one without a domain belongs to the page it was listed for. */
export function codeEntryOf(
  entry: Record<string, unknown>,
  host: string,
): CodeEntry {
  return {
    username: textOf(entry.username),
    domain: textOf(entry.domain) || host,
  }
}

/** Whether an authenticator entry belongs to the login with this username and site. */
export function isCodeFor(
  entry: CodeEntry,
  username: string,
  site: string,
): boolean {
  return entry.username === username && isSameSite(entry.domain, site)
}

/**
 * What a reply to a password read says about one login: its password, `null` when the helper has
 * none for it, as for a login with only a passkey, or `undefined` when the reply is about other
 * logins.
 */
export function passwordIn(
  reply: Record<string, unknown>,
  username: string,
  site: string,
): string | null | undefined {
  const entries = entriesOf(reply)
  const match = entries.find(
    (entry) =>
      (entry.USR ?? "") === username &&
      Array.isArray(entry.sites) &&
      entry.sites.some((listedSite) => isSameSite(String(listedSite), site)),
  )
  if (typeof match?.PWD === "string" && match.PWD) return match.PWD
  return match || !entries.length ? null : undefined
}

import { randomBytes, sha256, utf8 } from "@/lib/bytes"

/** A login submitted within this time after Keyward filled it is compared with what was filled. */
const FILL_TTL_MS = 5 * 60_000

interface FilledLogin {
  site: string
  vaultId: string
  loginId: string
  digest: string
  at: number
}

/**
 * The login Keyward last filled in each tab, with a salted digest of the password it filled.
 * Passwords does not show a saved password without Touch ID, so this is how a login submitted
 * afterwards is told to carry a password the user typed instead. It lives in memory only, which
 * lasts while Passwords is on, since its open port keeps the service worker running.
 */
const filledLogins = new Map<number, FilledLogin>()
const salt = randomBytes(16)

async function digestOf(password: string): Promise<string> {
  return (await sha256(salt, utf8(password))).toBase64()
}

export async function rememberFill(
  tabId: number,
  site: string,
  vaultId: string,
  loginId: string,
  password: string,
): Promise<void> {
  const digest = await digestOf(password)
  filledLogins.set(tabId, { site, vaultId, loginId, digest, at: Date.now() })
}

/**
 * Whether a password submitted in the tab is the one Keyward filled for this login moments ago;
 * undefined when it filled no password for the login there lately.
 */
export async function isFilledPassword(
  tabId: number,
  site: string,
  vaultId: string,
  loginId: string,
  password: string,
): Promise<boolean | undefined> {
  const filled = filledLogins.get(tabId)
  const matches =
    filled?.site === site &&
    filled.vaultId === vaultId &&
    filled.loginId === loginId &&
    Date.now() - filled.at <= FILL_TTL_MS
  if (!filled || !matches) return undefined
  return filled.digest === (await digestOf(password))
}

/** The login Keyward last filled in the tab on `site` if its password matches `password`. */
export async function filledLoginMatching(
  tabId: number,
  site: string,
  password: string,
): Promise<{ vaultId: string; loginId: string } | null> {
  const filled = filledLogins.get(tabId)
  if (
    !filled ||
    filled.site !== site ||
    Date.now() - filled.at > FILL_TTL_MS ||
    filled.digest !== (await digestOf(password))
  )
    return null
  return { vaultId: filled.vaultId, loginId: filled.loginId }
}

export function forgetFill(tabId: number): void {
  filledLogins.delete(tabId)
}

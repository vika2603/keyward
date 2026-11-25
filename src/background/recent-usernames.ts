import { storage } from "wxt/utils/storage"
import { serialQueue } from "@/lib/serial-queue"
import type { VaultView } from "./api"

/** A username typed on the first page of a two-step login is used for a password within this time. */
const USERNAME_TTL_MS = 5 * 60_000

/** The username each tab last signed in with, by tab ID, and the site it was for. */
type RememberedUsernames = Record<
  string,
  { site: string; username: string; at: number }
>

const usernamesItem = storage.defineItem<RememberedUsernames>(
  "session:save.usernames",
  { fallback: {} },
)
/** Tabs change the stored map one at a time, so none overwrites another's username. */
const usernamesChange = serialQueue()

function changeUsernames(
  change: (usernames: RememberedUsernames) => RememberedUsernames,
): Promise<void> {
  return usernamesChange(async () =>
    usernamesItem.setValue(change(await usernamesItem.getValue())),
  )
}

/** Remembers the username a tab last signed in with on a site, for the steps that follow. */
export function rememberUsername(
  tabId: number,
  site: string,
  username: string,
): Promise<void> {
  return changeUsernames((usernames) => ({
    ...usernames,
    [tabId]: { site, username, at: Date.now() },
  }))
}

export async function recallUsername(
  tabId: number,
  site: string,
): Promise<string | null> {
  const entry = (await usernamesItem.getValue())[tabId]
  if (!entry || entry.site !== site || Date.now() - entry.at > USERNAME_TTL_MS)
    return null
  return entry.username
}

export function forgetUsername(tabId: number): Promise<void> {
  return changeUsernames(({ [tabId]: _forgotten, ...rest }) => rest)
}

/**
 * Puts the login this tab used on the site moments ago first, in its vault and among the vaults,
 * so it is the first one offered for the next step.
 */
export function markRecent(
  vaults: VaultView[],
  username: string | null,
): VaultView[] {
  const name = username?.trim().toLowerCase()
  if (!name) return vaults
  const marked = vaults.map((vault) => {
    const logins = vault.logins.map((login) =>
      login.username.trim().toLowerCase() === name
        ? { ...login, recent: true }
        : login,
    )
    return {
      ...vault,
      logins: [
        ...logins.filter((login) => login.recent),
        ...logins.filter((login) => !login.recent),
      ],
    }
  })
  const hasRecent = (vault: VaultView) =>
    vault.logins.some((login) => login.recent)
  return [
    ...marked.filter(hasRecent),
    ...marked.filter((vault) => !hasRecent(vault)),
  ]
}

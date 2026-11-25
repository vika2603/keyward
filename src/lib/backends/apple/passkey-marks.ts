import { storage } from "wxt/utils/storage"

/** Enough for every login one person reads; the oldest marks go first. */
const MAX_MARKS = 500

/**
 * Logins Apple Passwords gave no password for, as a login with only a passkey does. Its listings
 * mark every login alike, so this is learned when a password is read. The IDs hold a username and
 * a site, no secrets.
 */
const marksItem = storage.defineItem<string[]>("local:apple.passkeyOnly", {
  fallback: [],
})

export async function passkeyOnlyIds(): Promise<Set<string>> {
  return new Set(await marksItem.getValue())
}

export async function markPasskeyOnly(
  loginId: string,
  passkeyOnly: boolean,
): Promise<void> {
  const marks = await marksItem.getValue()
  const has = marks.includes(loginId)
  if (has === passkeyOnly) return
  await marksItem.setValue(
    passkeyOnly
      ? [...marks, loginId].slice(-MAX_MARKS)
      : marks.filter((id) => id !== loginId),
  )
}

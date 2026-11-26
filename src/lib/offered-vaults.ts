import type { VaultView } from "@/background/api"

/** A vault that lists logins only once the user pairs it, unlocks it or sets it up. */
export function waitsForUser(vault: VaultView): boolean {
  return vault.status === "locked" || Boolean(vault.needsSetup)
}

/**
 * The vaults a list of a page's logins shows: those with logins or a problem to tell, and those
 * waiting for the user while no vault is open. Once one vault is open, the others are paired,
 * unlocked or set up from the popup instead, unless one is known to keep logins for the page.
 */
export function vaultsToOffer(vaults: VaultView[]): VaultView[] {
  const anyReady = vaults.some((vault) => vault.status === "ready")
  return vaults.filter((vault) => {
    if (waitsForUser(vault)) return !anyReady || Boolean(vault.keepsPageLogins)
    const hasLogins = vault.logins.length > 0
    return vault.status !== "ready" || Boolean(vault.error) || hasLogins
  })
}

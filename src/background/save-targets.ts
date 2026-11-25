import type { VaultInfo } from "@/lib/providers/types"
import { getSettings } from "@/lib/settings"
import type { Providers } from "./providers"

/** Vaults that can store a login for the page right now. */
export async function saveTargets(
  providers: Providers,
  page: URL,
): Promise<VaultInfo[]> {
  return (await providers.vaultsForPage(page)).filter(
    (vault) =>
      vault.status === "ready" && providers.providerOf(vault.id).canSave(page),
  )
}

/**
 * Vaults a save prompt offers for the page: those that can store the login, except any the user
 * told never to save logins for the site. A vault that cannot answer stays in.
 */
export async function promptTargets(
  providers: Providers,
  page: URL,
): Promise<VaultInfo[]> {
  const targets = await saveTargets(providers, page)
  const refusals = await Promise.all(
    targets.map((vault) =>
      (
        providers.providerOf(vault.id).refusesSaving?.(vault.id, page) ??
        Promise.resolve(false)
      ).catch(() => false),
    ),
  )
  return targets.filter((_, index) => !refusals[index])
}

/** The vault a new login goes to unless the user picks another: the one set in the options, or the first. */
export async function defaultTarget(
  targets: VaultInfo[],
): Promise<string | null> {
  const { defaultSaveTarget } = await getSettings()
  return (
    targets.find((target) => target.id === defaultSaveTarget)?.id ??
    targets[0]?.id ??
    null
  )
}

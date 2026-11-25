import { VaultError, type VaultProvider } from "@/lib/providers/types"
import type { Providers } from "../providers"
import { requireText } from "./validation"

/** What providers may leave out, such as notes, editing or a trash. */
type OptionalCapability = {
  [Name in keyof VaultProvider]-?: undefined extends VaultProvider[Name]
    ? Name
    : never
}[keyof VaultProvider]

interface NamedVault<Provider> {
  vaultId: string
  provider: Provider
}

export function notEditable(): VaultError {
  return new VaultError("The login cannot be changed", "notEditable")
}

export function noNotes(): VaultError {
  return new VaultError("The vault keeps no notes", "notFound")
}

/** The vault a request names, checked, with its provider. */
export function namedVault(
  providers: Providers,
  vaultId: unknown,
): NamedVault<VaultProvider> {
  const checkedId = requireText(vaultId, "vaultId")
  return { vaultId: checkedId, provider: providers.providerOf(checkedId) }
}

/**
 * The vault a request names, with its provider, which must offer `capability`; `missing` is the
 * error when it does not.
 */
export function namedVaultWith<Name extends OptionalCapability>(
  providers: Providers,
  vaultId: unknown,
  capability: Name,
  missing: () => VaultError = notEditable,
): NamedVault<VaultProvider & Required<Pick<VaultProvider, Name>>> {
  const vault = namedVault(providers, vaultId)
  if (!vault.provider[capability]) throw missing()
  return vault as NamedVault<
    VaultProvider & Required<Pick<VaultProvider, Name>>
  >
}

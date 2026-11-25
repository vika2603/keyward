import applePasswordsIcon from "@/assets/brands/apple-passwords.svg"
import bitwardenIcon from "@/assets/brands/bitwarden.svg"
import { t } from "@/lib/i18n"
import type { ProviderKind, VaultInfo } from "@/lib/providers/types"
import { cn } from "@/lib/utils"

const ICONS: Record<ProviderKind, string> = {
  apple: applePasswordsIcon,
  bitwarden: bitwardenIcon,
}

/** The provider's app icon. */
export function BrandIcon({
  kind,
  className,
}: {
  kind: ProviderKind
  className?: string
}) {
  return (
    <img
      src={ICONS[kind]}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn("size-4 shrink-0", className)}
    />
  )
}

export function providerName(kind: ProviderKind): string {
  return kind === "apple" ? t("common.applePasswords") : t("common.bitwarden")
}

/** A vault's name: Apple Passwords in the interface language, or a Bitwarden account's email. */
export function vaultLabel(vault: Pick<VaultInfo, "kind" | "label">): string {
  return vault.kind === "apple" ? providerName("apple") : vault.label
}

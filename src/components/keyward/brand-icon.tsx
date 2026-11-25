import applePasswordsIcon from "@/assets/brands/apple-passwords.svg"
import bitwardenIcon from "@/assets/brands/bitwarden.svg"
import type { BackendKind, SourceInfo } from "@/lib/backends/types"
import { t } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const ICONS: Record<BackendKind, string> = {
  apple: applePasswordsIcon,
  bitwarden: bitwardenIcon,
}

/** The backend's app icon. */
export function BrandIcon({
  kind,
  className,
}: {
  kind: BackendKind
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

export function backendName(kind: BackendKind): string {
  return kind === "apple" ? t("common.applePasswords") : t("common.bitwarden")
}

/** A source's name: Apple Passwords in the interface language, or a Bitwarden account's email. */
export function sourceLabel(
  source: Pick<SourceInfo, "kind" | "label">,
): string {
  return source.kind === "apple" ? backendName("apple") : source.label
}

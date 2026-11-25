import { siApple, siBitwarden } from "simple-icons"
import type { BackendKind, SourceInfo } from "@/lib/backends/types"
import { t } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const PATHS: Record<BackendKind, string> = {
  apple: siApple.path,
  bitwarden: siBitwarden.path,
}

/** The backend's brand mark, from Simple Icons. */
export function BrandIcon({
  kind,
  className,
}: {
  kind: BackendKind
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn("size-4 shrink-0 fill-current", className)}
    >
      <path d={PATHS[kind]} />
    </svg>
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

import { siApple, siBitwarden } from "simple-icons"
import type { BackendKind } from "@/lib/backends/types"
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

export const BACKEND_NAMES: Record<BackendKind, string> = {
  apple: "Apple 密码",
  bitwarden: "Bitwarden",
}

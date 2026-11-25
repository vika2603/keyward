import { t } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/**
 * An item's two lines: the first, usually a login's username, with its site or name below it, or
 * after it on the same line when the list is compact.
 */
export function LoginLabel({
  primary,
  detail,
  compact,
}: {
  /** The first line; empty shows that the login has no username. */
  primary: string
  detail: string
  compact: boolean
}) {
  return (
    <span
      className={cn(
        "flex min-w-0 flex-1",
        compact ? "items-baseline gap-2" : "flex-col",
      )}
    >
      <span className="truncate text-sm font-medium">
        {primary || t("common.noUsername")}
      </span>
      <span
        className={cn(
          "truncate text-xs text-muted-foreground",
          compact && "max-w-[45%] shrink-0",
        )}
      >
        {detail}
      </span>
    </span>
  )
}

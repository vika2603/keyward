import { Skeleton } from "@/components/ui/skeleton"
import { t } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/** Fades content in once it has loaded, in place of its placeholder. */
export const FADE_IN =
  "animate-in fade-in-0 duration-200 motion-reduce:animate-none"

const ROW_WIDTHS = ["w-32", "w-24", "w-36"]

/** Placeholder rows shaped like a list of logins, shown while the logins load. */
export function LoginListSkeleton({
  compact,
  heading = true,
}: {
  compact: boolean
  heading?: boolean
}) {
  return (
    <div role="status" className="flex flex-col gap-0.5 px-1.5 py-1">
      <span className="sr-only">{t("common.loading")}</span>
      {heading && <Skeleton className="mx-1.5 mt-2 mb-1 h-3 w-24" />}
      {ROW_WIDTHS.map((width) => (
        <div
          key={width}
          className={cn(
            "flex items-center gap-2.5 px-1.5 py-1.5",
            compact ? "min-h-9" : "min-h-12",
          )}
        >
          <Skeleton
            className={cn("shrink-0 rounded-md", compact ? "size-6" : "size-8")}
          />
          <div
            className={cn(
              "flex min-w-0 flex-1",
              compact ? "items-center gap-2" : "flex-col gap-1.5",
            )}
          >
            <Skeleton className={cn("h-3.5", width)} />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Placeholder lines for a form or a card of fields while it loads. */
export function FieldsSkeleton({ rows }: { rows: number }) {
  return (
    <div role="status" className="flex flex-col gap-3">
      <span className="sr-only">{t("common.loading")}</span>
      {Array.from({ length: rows }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the rows are identical placeholders.
        <div key={index} className="flex flex-col gap-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-9 w-full rounded-lg" />
        </div>
      ))}
    </div>
  )
}

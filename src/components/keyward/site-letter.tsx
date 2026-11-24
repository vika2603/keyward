import { cn } from "@/lib/utils"

/** A square with the first letter of a site or title, in place of a site icon. */
export function SiteLetter({
  text,
  className,
}: {
  text: string
  className?: string
}) {
  const letter =
    [...text.replace(/^www\./i, "").trim()][0]?.toUpperCase() ?? "?"
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-medium text-muted-foreground",
        className,
      )}
    >
      {letter}
    </span>
  )
}

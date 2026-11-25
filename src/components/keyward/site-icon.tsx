import { useState } from "react"
import { cn } from "@/lib/utils"

/**
 * A site's icon from the browser's own favicon cache, so no other server learns which sites the
 * logins are for, or the first letter of the site or title when there is no host or no icon. A
 * site the browser has no icon for shows its default globe.
 */
export function SiteIcon({
  host,
  text,
  className,
}: {
  host?: string
  text: string
  className?: string
}) {
  const [failed, setFailed] = useState(false)
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
      {host && !failed ? (
        <img
          alt=""
          className="size-4"
          src={`/_favicon/?pageUrl=${encodeURIComponent(`https://${host}/`)}&size=32`}
          onError={() => setFailed(true)}
        />
      ) : (
        letter
      )}
    </span>
  )
}

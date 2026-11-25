import { useState } from "react"
import { cn } from "@/lib/utils"

/** Whether an icon is drawn in mostly dark or mostly light pixels; `null` for coloured ones. */
type Tone = "dark" | "light" | null

/**
 * The tone of a loaded favicon. The browser keeps the variant a site served for the tab strip's
 * colour at the time of the visit, so the same site's icon may be black or white.
 */
function toneOf(image: HTMLImageElement): Tone {
  const size = 16
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext("2d", { willReadFrequently: true })
  if (!context) return null
  try {
    context.drawImage(image, 0, 0, size, size)
    const data = context.getImageData(0, 0, size, size).data
    let sum = 0
    let count = 0
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i + 3] ?? 0) < 128) continue
      const [r = 0, g = 0, b = 0] = [data[i], data[i + 1], data[i + 2]]
      sum += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
      count++
    }
    if (!count) return null
    const luminance = sum / count
    return luminance < 0.3 ? "dark" : luminance > 0.75 ? "light" : null
  } catch {
    return null
  }
}

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
  const [tone, setTone] = useState<Tone>(null)
  const letter =
    [...text.replace(/^www\./i, "").trim()][0]?.toUpperCase() ?? "?"
  const favicon = Boolean(host) && !failed
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-medium text-muted-foreground",
        className,
        // A dark icon on a light tile and a light one on a dark tile, hovered or not.
        favicon && tone === "dark" && "dark:bg-neutral-100!",
        favicon && tone === "light" && "bg-neutral-800!",
      )}
    >
      {favicon ? (
        <img
          alt=""
          className="size-4"
          src={`/_favicon/?pageUrl=${encodeURIComponent(`https://${host}/`)}&size=32`}
          onLoad={(event) => setTone(toneOf(event.currentTarget))}
          onError={() => setFailed(true)}
        />
      ) : (
        letter
      )}
    </span>
  )
}

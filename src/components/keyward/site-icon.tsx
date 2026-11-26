import { useEffect, useState } from "react"
import { type IconTone, iconToneOf, isGreyIcon } from "@/lib/icon-tone"
import { iconHostsOf } from "@/lib/site"
import { cn } from "@/lib/utils"

interface IconLook {
  tone: IconTone
  grey: boolean
}

/**
 * How a loaded favicon is drawn. The browser keeps the variant a site served for the tab strip's
 * colour at the time of the visit, so the same site's icon may be black or white.
 */
function lookOf(image: HTMLImageElement): IconLook {
  const size = 16
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext("2d", { willReadFrequently: true })
  if (!context) return { tone: null, grey: false }
  try {
    context.drawImage(image, 0, 0, size, size)
    const pixels = context.getImageData(0, 0, size, size).data
    return { tone: iconToneOf(pixels), grey: isGreyIcon(pixels) }
  } catch {
    return { tone: null, grey: false }
  }
}

function faviconUrl(host: string): string {
  return `/_favicon/?pageUrl=${encodeURIComponent(`https://${host}/`)}&size=32`
}

/** A host no site has, whose icon is the browser's default globe. */
const UNKNOWN_HOST = "keyward.invalid"

async function faviconBytes(host: string): Promise<Uint8Array> {
  const response = await fetch(faviconUrl(host))
  return new Uint8Array(await response.arrayBuffer())
}

function sameBytes(first: Uint8Array, second: Uint8Array): boolean {
  return (
    first.length === second.length &&
    first.every((byte, index) => byte === second[index])
  )
}

let defaultIcon: Promise<Uint8Array> | undefined
/** Each host's icon address once looked up, or null when the browser has none for it. */
const foundIcons = new Map<string, string | null>()
const lookups = new Map<string, Promise<string | null>>()

/**
 * The address of the first icon the browser has for the host or the hosts that can stand for it.
 * The browser answers a host it has no icon for with its default globe rather than an error, so
 * each answer is compared with the globe it gives an unknown host.
 */
function iconOf(host: string): Promise<string | null> {
  let lookup = lookups.get(host)
  if (!lookup) {
    lookup = (async () => {
      try {
        defaultIcon ??= faviconBytes(UNKNOWN_HOST)
        const fallback = await defaultIcon
        for (const candidate of iconHostsOf(host))
          if (!sameBytes(await faviconBytes(candidate), fallback))
            return faviconUrl(candidate)
      } catch {}
      return null
    })().then((found) => {
      foundIcons.set(host, found)
      return found
    })
    lookups.set(host, lookup)
  }
  return lookup
}

/** The host's icon address; null when there is none, undefined while it is being looked up. */
function useFavicon(host: string | undefined): string | null | undefined {
  const [looked, setLooked] = useState<{
    host: string
    found: string | null
  } | null>(null)
  useEffect(() => {
    if (!host || foundIcons.has(host)) return
    let current = true
    void iconOf(host).then((found) => {
      if (current) setLooked({ host, found })
    })
    return () => {
      current = false
    }
  }, [host])
  if (!host) return null
  if (foundIcons.has(host)) return foundIcons.get(host)
  return looked?.host === host ? looked.found : undefined
}

/**
 * A site's icon from the browser's own favicon cache, so no other server learns which sites the
 * logins are for, or the first letter of the site or title when there is no host or the browser
 * has no icon for it.
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
  const icon = useFavicon(host)
  const [failed, setFailed] = useState(false)
  const [look, setLook] = useState<IconLook>({ tone: null, grey: false })
  const letter =
    [...text.replace(/^www\./i, "").trim()][0]?.toUpperCase() ?? "?"
  const favicon = Boolean(icon) && !failed
  // A one-tone grey glyph is drawn black, or white on the dark theme, whichever variant the
  // browser kept; a one-tone coloured icon keeps its colours on a tile of the other tone.
  const recolored = favicon && look.tone !== null && look.grey
  const tileTone = favicon && !look.grey ? look.tone : null
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-medium text-muted-foreground",
        className,
        // A dark icon on a light tile and a light one on a dark tile, hovered or not.
        tileTone === "dark" && "dark:bg-neutral-100!",
        tileTone === "light" && "bg-neutral-800!",
      )}
    >
      {favicon ? (
        <img
          alt=""
          className={cn("size-4", recolored && "brightness-0 dark:invert")}
          src={icon ?? undefined}
          onLoad={(event) => setLook(lookOf(event.currentTarget))}
          onError={() => setFailed(true)}
        />
      ) : (
        // Nothing while the cache is asked, so a found icon does not replace a letter.
        icon !== undefined && letter
      )}
    </span>
  )
}

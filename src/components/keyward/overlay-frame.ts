import { type RefObject, useCallback, useEffect, useRef } from "react"
import { type BackgroundApi, callBackground } from "@/background/api"

let resolvedToken: string | null = null

/**
 * The session token the content script posts to the frame it created. Registered when the page's
 * script first runs, before the frame's load event, at which the content script posts it.
 */
const token = new Promise<string>((resolve) => {
  addEventListener("message", (event) => {
    const value = (event.data as { keywardOverlay?: unknown } | null)
      ?.keywardOverlay
    if (event.source === parent && typeof value === "string") {
      resolvedToken = value
      resolve(value)
    }
  })
})

/**
 * Runs `onFocus` when the content script moves focus here from the field on ArrowDown, proven by
 * the session token so a page calling `iframe.focus()` cannot select an item.
 */
export function onOverlayFocus(onFocus: () => void): () => void {
  const listener = (event: MessageEvent) => {
    const value = (event.data as { keywardOverlayFocus?: unknown } | null)
      ?.keywardOverlayFocus
    if (
      event.source === parent &&
      resolvedToken !== null &&
      value === resolvedToken
    )
      onFocus()
  }
  addEventListener("message", listener)
  return () => removeEventListener("message", listener)
}

type OverlayRequest = {
  [K in keyof BackgroundApi]: BackgroundApi[K]["payload"] extends {
    token: string
  }
    ? K
    : never
}[keyof BackgroundApi]

/** Sends an overlay request with the session token, which the background requires. */
export async function callOverlay<K extends OverlayRequest>(
  type: K,
  payload: Omit<BackgroundApi[K]["payload"], "token">,
): Promise<BackgroundApi[K]["result"]> {
  return callBackground(type, {
    ...payload,
    token: await token,
  } as BackgroundApi[K]["payload"])
}

/**
 * Reports the height of an overlay's card to the page that hosts the frame. `shown` tells when the
 * card element exists; the observer starts then.
 */
export function useReportHeight(
  ref: RefObject<HTMLElement | null>,
  shown: boolean,
  report: (height: number) => void,
  minHeight = 0,
): void {
  // biome-ignore lint/correctness/useExhaustiveDependencies: `report` may change identity on every render.
  useEffect(() => {
    const element = ref.current
    if (!shown || !element) return
    let last = -1
    const measure = () => {
      const next = Math.max(
        minHeight,
        Math.ceil(element.getBoundingClientRect().height),
      )
      if (next !== last) {
        last = next
        report(next)
      }
    }
    // Chrome skips rendering updates, ResizeObserver included, while the host holds the frame
    // hidden at height 0; re-measuring on DOM changes and when the frame itself resizes catches
    // anything rendered before the frame became visible.
    measure()
    const resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(element)
    const mutationObserver = new MutationObserver(measure)
    mutationObserver.observe(element, { childList: true, subtree: true })
    addEventListener("resize", measure)
    return () => {
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      removeEventListener("resize", measure)
    }
  }, [ref, shown, minHeight])
}

/** How long the frame must stay plainly visible, and in place, before a click on it counts. */
const SETTLE_MS = 500

/**
 * Returns a check for whether a click on the element should count. A page can fade or cover the
 * frame (seen through IntersectionObserver v2) or move it under the pointer just before a click
 * (reported by the content script); either way clicks count only after the frame has been
 * visible and still for a moment.
 */
export function useClickGuard(
  ref: RefObject<HTMLElement | null>,
  shown: boolean,
): () => boolean {
  const since = useRef<number | null>(null)
  useEffect(() => {
    const element = ref.current
    if (!shown || !element) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const visible = (entry as { isVisible?: boolean }).isVisible === true
          since.current = visible ? (since.current ?? performance.now()) : null
        }
      },
      // trackVisibility and delay are not in TypeScript's DOM types yet.
      {
        threshold: [0],
        trackVisibility: true,
        delay: 100,
      } as IntersectionObserverInit,
    )
    observer.observe(element)
    const onMoved = (event: MessageEvent) => {
      const moved = (event.data as { keywardOverlayMoved?: unknown } | null)
        ?.keywardOverlayMoved
      if (event.source === parent && moved && since.current !== null)
        since.current = performance.now()
    }
    addEventListener("message", onMoved)
    return () => {
      observer.disconnect()
      removeEventListener("message", onMoved)
    }
  }, [ref, shown])
  return useCallback(
    () =>
      since.current !== null && performance.now() - since.current >= SETTLE_MS,
    [],
  )
}

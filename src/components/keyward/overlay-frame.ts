import { type RefObject, useCallback, useEffect, useRef } from "react"
import { type BackgroundApi, callBackground } from "@/background/api"

/**
 * The session token the content script posts to the frame it created. Registered when the page's
 * script first runs, before the frame's load event, at which the content script posts it.
 */
const token = new Promise<string>((resolve) => {
  addEventListener("message", (event) => {
    const value = (event.data as { keywardOverlay?: unknown } | null)
      ?.keywardOverlay
    if (event.source === parent && typeof value === "string") resolve(value)
  })
})

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
): void {
  // biome-ignore lint/correctness/useExhaustiveDependencies: `report` may change identity on every render.
  useEffect(() => {
    const element = ref.current
    if (!shown || !element) return
    const measure = () =>
      report(Math.ceil(element.getBoundingClientRect().height))
    // Chrome skips rendering updates, ResizeObserver included, in a hidden or zero-height frame,
    // which is how the page holds this frame until it knows the height; the first value is measured directly.
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, shown])
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

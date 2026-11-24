import { type RefObject, useEffect, useRef } from "react"
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

/**
 * Whether the browser reports the element as unobscured and undistorted on screen
 * (IntersectionObserver v2). A page can make the frame transparent or cover it to lure a click
 * onto a login; clicks count only while this is true.
 */
export function useTrackVisible(
  ref: RefObject<HTMLElement | null>,
  shown: boolean,
): RefObject<boolean> {
  const visible = useRef(false)
  useEffect(() => {
    const element = ref.current
    if (!shown || !element) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          visible.current =
            (entry as { isVisible?: boolean }).isVisible === true
      },
      // trackVisibility and delay are not in TypeScript's DOM types yet.
      {
        threshold: [0],
        trackVisibility: true,
        delay: 100,
      } as IntersectionObserverInit,
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, shown])
  return visible
}

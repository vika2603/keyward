import { useCallback, useEffect, useEffectEvent, useState } from "react"
import { type BackgroundApi, callBackground } from "@/background/api"

type Request = keyof BackgroundApi & string

export interface BackgroundQuery<T> {
  /** The reply; null until it arrives, and when the request failed before any reply came. */
  data: T | null
  /** Why the last request failed; null while none has failed since the last reply. */
  error: unknown
  /** Asks again; the reply so far stays until the new one replaces it. */
  reload: () => void
  /** Changes the reply in place, as after a change the view made itself. */
  update: (change: (data: T) => T) => void
}

/**
 * Asks the background once, and again when the request's payload changes or `reload` is called. A
 * reply to a request that a newer one replaced is dropped. `onError` hears of each failure, for a
 * view that shows it as a toast; others show `error` where the reply would be.
 */
export function useBackgroundQuery<Type extends Request>(
  type: Type,
  payload: BackgroundApi[Type]["payload"],
  {
    onError,
  }: {
    onError?: (error: unknown) => void
  } = {},
): BackgroundQuery<BackgroundApi[Type]["result"]> {
  type Result = BackgroundApi[Type]["result"]
  // Payloads are plain data, so their text tells requests apart; one built anew on each render asks
  // once.
  const key = `${type}:${JSON.stringify(payload) ?? ""}`
  const [reply, setReply] = useState<{
    key: string
    data: Result | null
    error: unknown
  } | null>(null)
  const [loadCount, setLoadCount] = useState(0)

  const ask = useEffectEvent(() => callBackground(type, payload))
  const fail = useEffectEvent((error: unknown) => onError?.(error))
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` and `loadCount` ask again.
  useEffect(() => {
    let current = true
    ask().then(
      (data) => {
        if (current) setReply({ key, data, error: null })
      },
      (error) => {
        if (!current) return
        setReply((previous) => ({
          key,
          data: previous?.key === key ? previous.data : null,
          error,
        }))
        fail(error)
      },
    )
    return () => {
      current = false
    }
  }, [key, loadCount])

  const reload = useCallback(() => setLoadCount((count) => count + 1), [])
  const update = useCallback(
    (change: (data: Result) => Result) =>
      setReply((previous) =>
        previous && previous.data !== null
          ? { ...previous, data: change(previous.data) }
          : previous,
      ),
    [],
  )
  const own = reply?.key === key ? reply : null
  return { data: own?.data ?? null, error: own?.error ?? null, reload, update }
}

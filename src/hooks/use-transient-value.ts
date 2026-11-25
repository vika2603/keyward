import { useCallback, useEffect, useState } from "react"

/** How long a button shows its check mark once its copy went through. */
export const COPIED_FEEDBACK_MS = 1500

/**
 * A value that clears itself a moment after it is set, such as which button just copied. Setting
 * it again starts the moment over.
 */
export function useTransientValue<T>(
  duration: number,
): [T | null, (value: T) => void] {
  const [shown, setShown] = useState<{ value: T } | null>(null)
  useEffect(() => {
    if (!shown) return
    const timer = setTimeout(() => setShown(null), duration)
    return () => clearTimeout(timer)
  }, [shown, duration])
  const show = useCallback((value: T) => setShown({ value }), [])
  return [shown?.value ?? null, show]
}

import { useCallback, useState } from "react"
import { errorMessage } from "@/components/keyward/errors"

/**
 * A form's action that runs in the background: `busy` while it runs, and the error's message, for
 * the form to show, once it failed.
 */
export function useAsyncAction() {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  /** Runs the action; false when it failed. */
  const run = useCallback(
    async (action: () => Promise<unknown>): Promise<boolean> => {
      setBusy(true)
      setMessage(null)
      try {
        await action()
        return true
      } catch (error) {
        setMessage(errorMessage(error))
        return false
      } finally {
        setBusy(false)
      }
    },
    [],
  )
  return { busy, message, setMessage, run }
}

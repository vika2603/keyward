import { toast } from "@/components/ui/toast"
import { t } from "@/lib/i18n"
import { errorMessage, isUnsupportedRequest } from "./errors"

/** Shows a short message at the bottom of the view; the same message shown again replaces it. */
export function notify(text: string, type: "error" | "info" = "info"): void {
  toast.add({ id: `${type}:${text}`, type, title: text })
}

/**
 * Shows an error as a toast. A request the background lacks gets an explanation rather than an
 * error: reloading Keyward would end the Passwords pairing and lock Bitwarden, so the feature
 * waits for Keyward's next start.
 */
export function notifyError(error: unknown): void {
  if (isUnsupportedRequest(error)) {
    toast.add({
      id: "unsupported",
      type: "info",
      title: t("error.unsupported"),
      description: t("error.unsupported.detail"),
    })
    return
  }
  const text = errorMessage(error)
  if (text) notify(text, "error")
}

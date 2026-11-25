import { toast } from "@/components/ui/toast"
import { t } from "@/lib/i18n"
import { errorCodeOf, errorMessage } from "./errors"

/** Shows a short message at the bottom of the view; the same message shown again replaces it. */
export function notify(text: string, type: "error" | "info" = "info"): void {
  toast.add({ id: `${type}:${text}`, type, title: text })
}

/**
 * Shows an error as a toast. A background that does not answer most often runs older code than
 * the page, as after a rebuild without a reload, so its toast offers to reload Keyward.
 */
export function notifyError(error: unknown): void {
  if (errorCodeOf(error) === "noResponse") {
    toast.add({
      id: "noResponse",
      type: "error",
      title: t("error.noResponse"),
      description: t("error.noResponse.reloadHint"),
      timeout: 0,
      actionProps: {
        children: t("error.noResponse.reload"),
        onClick: () => browser.runtime.reload(),
      },
    })
    return
  }
  const text = errorMessage(error)
  if (text) notify(text, "error")
}

import type { Handlers } from "@/lib/messaging"
import type { BackgroundApi } from "../api"
import { openPopup } from "../popup-window"

/** Requests from the pages that set Keyward up in a tab: the welcome page and the Passwords setup. */
export function pageHandlers() {
  return {
    "page.openPopup": {
      allow: ["welcomePage", "connectPage"],
      handle: async () => {
        await openPopup({ name: "main" })
        return null
      },
    },
  } satisfies Partial<Handlers<BackgroundApi>>
}

import type { Handlers } from "@/lib/messaging"
import type { BackgroundApi } from "../api"
import { openPopup } from "../popup-window"

/** Requests from the welcome page, which a new install opens in a tab. */
export function welcomeHandlers() {
  return {
    "welcome.openPopup": {
      allow: ["welcomePage"],
      handle: async () => {
        await openPopup({ name: "main" })
        return null
      },
    },
  } satisfies Partial<Handlers<BackgroundApi>>
}

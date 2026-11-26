import type { Handlers } from "@/lib/messaging"
import type { BackgroundApi } from "../api"
import type { HttpAuth } from "../http-auth"
import { popupOnly } from "./request-context"
import { requireText } from "./validation"

/** Requests from the popup that lists the logins of a site asking through the browser's dialog. */
export function httpAuthHandlers(httpAuth: HttpAuth) {
  return {
    "popup.httpAuth": {
      allow: popupOnly,
      handle: () => httpAuth.view(),
    },
    "popup.answerHttpAuth": {
      allow: popupOnly,
      handle: async ({ vaultId, loginId }) => {
        await httpAuth.answer(
          requireText(vaultId, "vaultId"),
          requireText(loginId, "loginId"),
        )
        return null
      },
    },
    "popup.declineHttpAuth": {
      allow: popupOnly,
      handle: () => {
        httpAuth.decline()
        return null
      },
    },
  } satisfies Partial<Handlers<BackgroundApi>>
}

import type { Handlers } from "@/lib/messaging"
import type { AppleProvider } from "@/lib/providers/apple/apple-provider"
import {
  type AppleState,
  needsSetup,
} from "@/lib/providers/apple/helper-session"
import { VaultError } from "@/lib/providers/types"
import { getSettings, updateSettings } from "@/lib/settings"
import type { BackgroundApi } from "../api"
import { MAX_HOST_LENGTH } from "../limits"
import { connectPages, popupOnly } from "./request-context"
import { requireText, siteInput } from "./validation"

export function appleHandlers(apple: AppleProvider) {
  /**
   * Connects to the helper and turns Passwords on, as using it from a page means. While this Mac
   * lacks the one-time setup, Passwords stays as it was, so no view offers a vault that cannot
   * connect unless the user had turned it on.
   */
  const connect = async (): Promise<AppleState> => {
    const wasEnabled = (await getSettings()).appleEnabled
    await apple.helper.setEnabled(true)
    const state = apple.helper.getState()
    if (needsSetup(state)) {
      if (!wasEnabled) await apple.helper.setEnabled(false)
      return state
    }
    if (!wasEnabled) await updateSettings({ appleEnabled: true })
    return state
  }

  return {
    "apple.state": {
      allow: connectPages,
      handle: () => apple.helper.getState(),
    },
    "apple.startPairing": {
      allow: connectPages,
      handle: async ({ restart }) => {
        const state = await connect()
        if (needsSetup(state)) return state
        await apple.helper.startPairing(Boolean(restart))
        return apple.helper.getState()
      },
    },
    "apple.checkSetup": {
      allow: [...connectPages, "connectPage"],
      handle: () => connect(),
    },
    "apple.submitCode": {
      allow: connectPages,
      handle: async ({ code }) => {
        if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
          throw new VaultError("The code has six digits", "invalidInput")
        }
        await apple.helper.submitCode(code)
        return apple.helper.getState()
      },
    },
    "apple.openPasswordsApp": {
      allow: connectPages,
      handle: async ({ site }) => {
        await apple.openPasswordsApp(
          site === undefined
            ? undefined
            : requireText(site, "site", MAX_HOST_LENGTH),
        )
        return null
      },
    },
    "apple.openNewPasswordSheet": {
      allow: popupOnly,
      handle: async ({ site }) => {
        const url = siteInput(site)
        if (!url) throw new VaultError("Not a web address", "invalidSite")
        await apple.openNewPasswordSheet(url.hostname)
        return null
      },
    },
  } satisfies Partial<Handlers<BackgroundApi>>
}

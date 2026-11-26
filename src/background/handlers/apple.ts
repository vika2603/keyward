import type { Handlers } from "@/lib/messaging"
import type { AppleProvider } from "@/lib/providers/apple/apple-provider"
import { VaultError } from "@/lib/providers/types"
import { getSettings, updateSettings } from "@/lib/settings"
import type { BackgroundApi } from "../api"
import { MAX_HOST_LENGTH } from "../limits"
import { connectPages, popupOnly } from "./request-context"
import { requireText, siteInput } from "./validation"

export function appleHandlers(apple: AppleProvider) {
  /** Turns Passwords on, as using it from a page means, and connects to the helper. */
  const enable = async () => {
    if (!(await getSettings()).appleEnabled)
      await updateSettings({ appleEnabled: true })
    await apple.helper.setEnabled(true)
  }

  return {
    "apple.state": {
      allow: connectPages,
      handle: () => apple.helper.getState(),
    },
    "apple.startPairing": {
      allow: connectPages,
      handle: async ({ restart }) => {
        await enable()
        await apple.helper.startPairing(Boolean(restart))
        return apple.helper.getState()
      },
    },
    "apple.checkSetup": {
      allow: connectPages,
      handle: async () => {
        await enable()
        return apple.helper.getState()
      },
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

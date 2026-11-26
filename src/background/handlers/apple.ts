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
  /** Connects to the helper without pairing, so nothing shows on the Mac. */
  const reach = async (): Promise<AppleState> => {
    await apple.helper.setEnabled(true)
    return apple.helper.getState()
  }
  /** Leaves the helper off again unless Passwords is on by now; the user may turn it on meanwhile. */
  const followSwitch = async () => {
    if (!(await getSettings()).appleEnabled)
      await apple.helper.setEnabled(false)
  }

  return {
    "apple.state": {
      allow: popupOnly,
      handle: () => apple.helper.getState(),
    },
    "apple.startPairing": {
      allow: popupOnly,
      handle: async ({ restart }) => {
        const state = await reach()
        if (needsSetup(state)) {
          await followSwitch()
          return state
        }
        // Pairing from a page is using Passwords, so it turns Passwords on.
        if (!(await getSettings()).appleEnabled)
          await updateSettings({ appleEnabled: true })
        await apple.helper.startPairing(Boolean(restart))
        return apple.helper.getState()
      },
    },
    "apple.checkSetup": {
      allow: [...connectPages, "connectPage", "welcomePage"],
      handle: () => apple.helper.checkSetup(),
    },
    "apple.submitCode": {
      allow: popupOnly,
      handle: async ({ code }) => {
        if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
          throw new VaultError("The code has six digits", "invalidInput")
        }
        await apple.helper.submitCode(code)
        return apple.helper.getState()
      },
    },
    "apple.openPasswordsApp": {
      allow: popupOnly,
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

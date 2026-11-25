import type { Handlers } from "@/lib/messaging"
import { VaultError } from "@/lib/providers/types"
import { getSettings, updateSettings } from "@/lib/settings"
import { normalizeSiteInput } from "@/lib/site"
import type { BackgroundApi } from "../api"
import type { Providers } from "../providers"
import { connectPages, popupOnly } from "./request-context"
import { requireText } from "./validation"

export function appleHandlers(providers: Providers) {
  const { apple } = providers
  return {
    "apple.state": { allow: connectPages, handle: () => apple.getState() },
    "apple.startPairing": {
      allow: connectPages,
      handle: async ({ restart }) => {
        if (!(await getSettings()).appleEnabled)
          await updateSettings({ appleEnabled: true })
        await apple.setEnabled(true)
        await apple.startPairing(Boolean(restart))
        return apple.getState()
      },
    },
    "apple.submitCode": {
      allow: connectPages,
      handle: async ({ code }) => {
        if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
          throw new VaultError("The code has six digits", "invalidInput")
        }
        await apple.submitCode(code)
        return apple.getState()
      },
    },
    "apple.openPasswordsApp": {
      allow: connectPages,
      handle: async ({ site }) => {
        await apple.openPasswordsApp(
          site === undefined ? undefined : requireText(site, "site", 253),
        )
        return null
      },
    },
    "apple.openNewPasswordSheet": {
      allow: popupOnly,
      handle: async ({ site }) => {
        const url = normalizeSiteInput(requireText(site, "site", 2048))
        if (!url) throw new VaultError("Not a web address", "invalidSite")
        await apple.openNewPasswordSheet(url.hostname)
        return null
      },
    },
  } satisfies Partial<Handlers<BackgroundApi>>
}

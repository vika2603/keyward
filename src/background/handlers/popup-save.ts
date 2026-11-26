import type { Handlers } from "@/lib/messaging"
import { VaultError, type VaultInfo } from "@/lib/providers/types"
import { keyLabel } from "@/lib/totp"
import type { BackgroundApi } from "../api"
import { finishSetup, pendingSetup } from "../code-setup"
import type { Providers } from "../providers"
import { defaultTarget, saveTargets } from "../save-targets"
import { namedVault, namedVaultWith } from "./capabilities"
import { popupOnly, popupTab } from "./request-context"
import {
  newLoginDetailsInput,
  optionalText,
  requireText,
  siteInput,
} from "./validation"

export function popupSaveHandlers(providers: Providers) {
  return {
    "popup.saveTargets": {
      allow: popupOnly,
      handle: async ({ site }) => {
        const ready = await providers.savable()
        const url = siteInput(site)
        const targets = url ? await saveTargets(providers, url) : ready
        return {
          targets,
          defaultTarget: await defaultTarget(targets),
          unsupported: url
            ? ready.filter(
                (vault) => !providers.providerOf(vault.id).canSave(url),
              )
            : [],
        }
      },
    },
    "popup.saveLogin": {
      allow: popupOnly,
      handle: async ({ vaultId, site, username, password, details }) => {
        const url = siteInput(site)
        if (!url) throw new VaultError("Not a web address", "invalidSite")
        const checkedUsername = requireText(username, "username").trim()
        const checkedPassword = requireText(password, "password")
        if (!checkedUsername && !checkedPassword)
          throw new VaultError("No username or password", "invalidInput")
        const vault = namedVault(providers, vaultId)
        const targets = await saveTargets(providers, url)
        if (!targets.some((target) => target.id === vault.vaultId)) {
          throw new VaultError(
            "The chosen place is not available",
            "unknownVault",
          )
        }
        await vault.provider.save(
          vault.vaultId,
          {
            url,
            username: checkedUsername,
            password: checkedPassword,
            details: newLoginDetailsInput(details),
          },
          await popupTab(),
        )
        return null
      },
    },
    "popup.codeSetup": {
      allow: popupOnly,
      handle: async () => {
        const { uri, page } = await pendingSetup()
        const vaults = await providers.loginsForPage(page)
        const setupOf = (vault: VaultInfo) =>
          providers.providerOf(vault.id).codeSetup?.(vault.id, page) ?? null
        const ready = vaults.filter((vault) => vault.status === "ready")
        return {
          host: page.hostname,
          ...keyLabel(uri),
          apple: ready.some((vault) => setupOf(vault) === "app"),
          vaults: ready.filter(
            (vault) => setupOf(vault) === "login" && !vault.error,
          ),
          locked: vaults
            .filter((vault) => vault.status === "locked" && setupOf(vault))
            .map(({ logins: _, ...info }) => info),
        }
      },
    },
    "popup.setUpCode": {
      allow: popupOnly,
      handle: async ({ vaultId, loginId }) => {
        const { uri, page } = await pendingSetup()
        const vault = namedVaultWith(providers, vaultId, "setUpCode")
        await vault.provider.setUpCode(
          vault.vaultId,
          optionalText(loginId, "loginId"),
          page,
          uri,
        )
        await finishSetup()
        return null
      },
    },
  } satisfies Partial<Handlers<BackgroundApi>>
}

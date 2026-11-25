import type { Handlers } from "@/lib/messaging"
import { VaultError } from "@/lib/providers/types"
import { normalizeSiteInput } from "@/lib/site"
import { keyLabel } from "@/lib/totp"
import type { BackgroundApi } from "../api"
import { finishSetup, pendingSetup } from "../code-setup"
import type { Providers } from "../providers"
import { defaultTarget, saveTargets } from "../save-flow"
import { activePage, popupOnly } from "./request-context"
import { newLoginDetailsInput, requireText } from "./validation"

export function popupSaveHandlers(providers: Providers) {
  const { apple, bitwarden } = providers
  return {
    "popup.saveTargets": {
      allow: popupOnly,
      handle: async ({ site }) => {
        const ready = await providers.savable()
        const url = normalizeSiteInput(requireText(site, "site", 2048))
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
        const url = normalizeSiteInput(requireText(site, "site"))
        if (!url) throw new VaultError("Not a web address", "invalidSite")
        if (!requireText(password, "password"))
          throw new VaultError("Empty password", "invalidInput")
        if (
          !(await saveTargets(providers, url)).some(
            (vault) => vault.id === vaultId,
          )
        ) {
          throw new VaultError(
            "The chosen place is not available",
            "unknownVault",
          )
        }
        const { tabId } = await activePage()
        await providers.providerOf(vaultId).save(
          vaultId,
          {
            url,
            username: requireText(username, "username").trim(),
            password,
            details: newLoginDetailsInput(details),
          },
          {
            tabId: tabId ?? 0,
            frameId: 0,
          },
        )
        return null
      },
    },
    "popup.codeSetup": {
      allow: popupOnly,
      handle: async () => {
        const { uri, page } = await pendingSetup()
        const vaults = await providers.loginsForPage(page)
        return {
          host: page.hostname,
          ...keyLabel(uri),
          apple: apple.canSetUpCodes() && apple.canSave(page),
          vaults: vaults.filter(
            (vault) =>
              vault.kind === "bitwarden" &&
              vault.status === "ready" &&
              !vault.error,
          ),
          locked: vaults
            .filter(
              (vault) =>
                vault.status === "locked" &&
                (vault.kind === "bitwarden" || apple.canSave(page)),
            )
            .map(({ logins: _, ...info }) => info),
        }
      },
    },
    "popup.setUpCode": {
      allow: popupOnly,
      handle: async ({ vaultId, loginId }) => {
        const { uri, page } = await pendingSetup()
        if (providers.providerOf(requireText(vaultId, "vaultId")) === apple) {
          if (!apple.canSave(page))
            throw new VaultError(
              "Apple Passwords does not store logins for this host",
              "apple.unsupportedSite",
            )
          await apple.setUpCode(page.hostname, uri)
        } else {
          await bitwarden.setCode(
            vaultId,
            requireText(loginId, "loginId"),
            page,
            uri,
          )
        }
        await finishSetup()
        return null
      },
    },
  } satisfies Partial<Handlers<BackgroundApi>>
}

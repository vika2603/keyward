import type { Handlers } from "@/lib/messaging"
import { type Credential, VaultError } from "@/lib/providers/types"
import type { BackgroundApi } from "../api"
import { copyText } from "../clipboard"
import { MAX_COPIED_TEXT_LENGTH, MAX_SEARCH_LENGTH } from "../limits"
import { takeRequestedView } from "../popup-window"
import type { Providers } from "../providers"
import { namedVault, namedVaultWith } from "./capabilities"
import { activePage, popupOnly, popupTab } from "./request-context"
import { loginEdit, requireBoolean, requireText } from "./validation"

export function popupItemHandlers(providers: Providers) {
  const { apple } = providers

  /** A login's password, read for the popup's own views; it never goes into a page from here. */
  const popupCredential = async (
    vaultId: unknown,
    loginId: unknown,
  ): Promise<Credential> => {
    const vault = namedVault(providers, vaultId)
    return vault.provider.credential(
      vault.vaultId,
      requireText(loginId, "loginId"),
      null,
      await popupTab(),
    )
  }

  return {
    "popup.state": {
      allow: popupOnly,
      handle: async () => {
        const { page } = await activePage()
        return {
          page: page ? { url: page.href, host: page.hostname } : null,
          vaults: await providers.loginsForPage(page),
        }
      },
    },
    "popup.takeView": {
      allow: popupOnly,
      handle: async () => {
        const requested = await takeRequestedView()
        if (requested) return requested
        if (apple.getState().phase === "awaitingCode")
          return { name: "connect", kind: "apple" }
        return { name: "main" }
      },
    },
    "popup.search": {
      allow: popupOnly,
      handle: ({ query }) =>
        providers.search(requireText(query, "query", MAX_SEARCH_LENGTH)),
    },
    "popup.copyPassword": {
      allow: popupOnly,
      handle: async ({ vaultId, loginId }) => {
        const { password } = await popupCredential(vaultId, loginId)
        if (!password)
          throw new VaultError("The login has no password", "noPassword")
        await copyText(password, true)
        return null
      },
    },
    "popup.copyText": {
      allow: popupOnly,
      handle: async ({ text, secret }) => {
        await copyText(
          requireText(text, "text", MAX_COPIED_TEXT_LENGTH),
          secret === true,
        )
        return null
      },
    },
    "popup.details": {
      allow: popupOnly,
      handle: ({ vaultId, loginId }) => {
        const vault = namedVault(providers, vaultId)
        return vault.provider.details(
          vault.vaultId,
          requireText(loginId, "loginId"),
          null,
        )
      },
    },
    "popup.revealPassword": {
      allow: popupOnly,
      handle: async ({ vaultId, loginId }) => {
        const { password } = await popupCredential(vaultId, loginId)
        return { password }
      },
    },
    "popup.oneTimeCode": {
      allow: popupOnly,
      handle: async ({ vaultId, loginId }) => {
        const vault = namedVault(providers, vaultId)
        return vault.provider.oneTimeCode(
          vault.vaultId,
          requireText(loginId, "loginId"),
          null,
          await popupTab(),
        )
      },
    },
    "popup.passwordHistory": {
      allow: popupOnly,
      handle: ({ vaultId, loginId }) => {
        const vault = namedVaultWith(
          providers,
          vaultId,
          "passwordHistory",
          () =>
            new VaultError("The vault keeps no password history", "notFound"),
        )
        return vault.provider.passwordHistory(
          vault.vaultId,
          requireText(loginId, "loginId"),
        )
      },
    },
    "popup.editable": {
      allow: popupOnly,
      handle: ({ vaultId, loginId }) => {
        const vault = namedVaultWith(providers, vaultId, "editable")
        return vault.provider.editable(
          vault.vaultId,
          requireText(loginId, "loginId"),
        )
      },
    },
    "popup.editLogin": {
      allow: popupOnly,
      handle: async ({ vaultId, loginId, change }) => {
        const vault = namedVaultWith(providers, vaultId, "edit")
        await vault.provider.edit(
          vault.vaultId,
          requireText(loginId, "loginId"),
          loginEdit(change),
        )
        return null
      },
    },
    "popup.folders": {
      allow: popupOnly,
      handle: async ({ vaultId }) => {
        const vault = namedVault(providers, vaultId)
        return vault.provider.folders
          ? vault.provider.folders(vault.vaultId)
          : []
      },
    },
    "popup.passReprompt": {
      allow: popupOnly,
      handle: async ({ vaultId, itemId, password }) => {
        const vault = namedVaultWith(providers, vaultId, "passReprompt")
        await vault.provider.passReprompt(
          vault.vaultId,
          requireText(itemId, "itemId"),
          requireText(password, "password"),
        )
        return null
      },
    },
    "popup.restoreItem": {
      allow: popupOnly,
      handle: async ({ vaultId, itemId }) => {
        const vault = namedVaultWith(providers, vaultId, "restore")
        await vault.provider.restore(
          vault.vaultId,
          requireText(itemId, "itemId"),
        )
        return null
      },
    },
    "popup.purgeItem": {
      allow: popupOnly,
      handle: async ({ vaultId, itemId }) => {
        const vault = namedVaultWith(providers, vaultId, "purge")
        await vault.provider.purge(vault.vaultId, requireText(itemId, "itemId"))
        return null
      },
    },
    "popup.setFavorite": {
      allow: popupOnly,
      handle: async ({ vaultId, itemId, favorite }) => {
        const vault = namedVaultWith(providers, vaultId, "setFavorite")
        await vault.provider.setFavorite(
          vault.vaultId,
          requireText(itemId, "itemId"),
          requireBoolean(favorite, "favorite"),
        )
        return null
      },
    },
    "popup.removeLogin": {
      allow: popupOnly,
      handle: async ({ vaultId, loginId }) => {
        const vault = namedVaultWith(providers, vaultId, "remove")
        await vault.provider.remove(
          vault.vaultId,
          requireText(loginId, "loginId"),
        )
        return null
      },
    },
    "popup.allItems": {
      allow: popupOnly,
      handle: () => providers.allItems(),
    },
    "popup.lock": {
      allow: popupOnly,
      handle: async ({ vaultId }) => {
        const vault = namedVault(providers, vaultId)
        await vault.provider.lock(vault.vaultId)
        return null
      },
    },
    "popup.lockAll": {
      allow: popupOnly,
      handle: async () => {
        await providers.lockAll()
        return null
      },
    },
  } satisfies Partial<Handlers<BackgroundApi>>
}

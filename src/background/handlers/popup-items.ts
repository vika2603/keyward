import type { Handlers } from "@/lib/messaging"
import { VaultError } from "@/lib/providers/types"
import type { BackgroundApi } from "../api"
import { copyText } from "../clipboard"
import { takeRequestedView } from "../popup-window"
import type { Providers } from "../providers"
import { notEditable } from "./capabilities"
import { activePage, popupOnly, popupTab } from "./request-context"
import { loginEdit, requireText } from "./validation"

export function popupItemHandlers(providers: Providers) {
  const { apple } = providers
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
      handle: ({ query }) => providers.search(requireText(query, "query", 256)),
    },
    "popup.copyPassword": {
      allow: popupOnly,
      handle: async ({ vaultId, loginId }) => {
        const credential = await providers
          .providerOf(vaultId)
          .credential(vaultId, loginId, null, await popupTab())
        await copyText(credential.password, true)
        return null
      },
    },
    "popup.copyText": {
      allow: popupOnly,
      handle: async ({ text, secret }) => {
        await copyText(requireText(text, "text", 8192), secret === true)
        return null
      },
    },
    "popup.details": {
      allow: popupOnly,
      handle: ({ vaultId, loginId }) =>
        providers.providerOf(vaultId).details(vaultId, loginId, null),
    },
    "popup.revealPassword": {
      allow: popupOnly,
      handle: async ({ vaultId, loginId }) => {
        const { password } = await providers
          .providerOf(vaultId)
          .credential(vaultId, loginId, null, await popupTab())
        return { password }
      },
    },
    "popup.oneTimeCode": {
      allow: popupOnly,
      handle: async ({ vaultId, loginId }) =>
        providers
          .providerOf(vaultId)
          .oneTimeCode(vaultId, loginId, null, await popupTab()),
    },
    "popup.passwordHistory": {
      allow: popupOnly,
      handle: ({ vaultId, loginId }) => {
        const provider = providers.providerOf(vaultId)
        if (!provider.passwordHistory)
          throw new VaultError(
            "The vault keeps no password history",
            "notFound",
          )
        return provider.passwordHistory(
          vaultId,
          requireText(loginId, "loginId"),
        )
      },
    },
    "popup.editable": {
      allow: popupOnly,
      handle: ({ vaultId, loginId }) => {
        const provider = providers.providerOf(vaultId)
        if (!provider.editable) throw notEditable()
        return provider.editable(vaultId, requireText(loginId, "loginId"))
      },
    },
    "popup.editLogin": {
      allow: popupOnly,
      handle: async ({ vaultId, loginId, change }) => {
        const provider = providers.providerOf(vaultId)
        if (!provider.edit) throw notEditable()
        await provider.edit(
          vaultId,
          requireText(loginId, "loginId"),
          loginEdit(change),
        )
        return null
      },
    },
    "popup.folders": {
      allow: popupOnly,
      handle: async ({ vaultId }) => {
        const provider = providers.providerOf(requireText(vaultId, "vaultId"))
        return provider.folders ? provider.folders(vaultId) : []
      },
    },
    "popup.passReprompt": {
      allow: popupOnly,
      handle: async ({ vaultId, itemId, password }) => {
        const provider = providers.providerOf(vaultId)
        if (!provider.passReprompt) throw notEditable()
        await provider.passReprompt(
          vaultId,
          requireText(itemId, "itemId"),
          requireText(password, "password"),
        )
        return null
      },
    },
    "popup.restoreItem": {
      allow: popupOnly,
      handle: async ({ vaultId, itemId }) => {
        const provider = providers.providerOf(vaultId)
        if (!provider.restore) throw notEditable()
        await provider.restore(vaultId, requireText(itemId, "itemId"))
        return null
      },
    },
    "popup.purgeItem": {
      allow: popupOnly,
      handle: async ({ vaultId, itemId }) => {
        const provider = providers.providerOf(vaultId)
        if (!provider.purge) throw notEditable()
        await provider.purge(vaultId, requireText(itemId, "itemId"))
        return null
      },
    },
    "popup.setFavorite": {
      allow: popupOnly,
      handle: async ({ vaultId, itemId, favorite }) => {
        const provider = providers.providerOf(vaultId)
        if (!provider.setFavorite) throw notEditable()
        if (typeof favorite !== "boolean")
          throw new VaultError("Invalid favorite", "invalidInput")
        await provider.setFavorite(
          vaultId,
          requireText(itemId, "itemId"),
          favorite,
        )
        return null
      },
    },
    "popup.removeLogin": {
      allow: popupOnly,
      handle: async ({ vaultId, loginId }) => {
        const provider = providers.providerOf(vaultId)
        if (!provider.remove) throw notEditable()
        await provider.remove(vaultId, requireText(loginId, "loginId"))
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
        const id = requireText(vaultId, "vaultId")
        await providers.providerOf(id).lock(id)
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

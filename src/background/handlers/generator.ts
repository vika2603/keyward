import type { Handlers } from "@/lib/messaging"
import { VaultError } from "@/lib/providers/types"
import { normalizeSiteInput } from "@/lib/site"
import type { BackgroundApi } from "../api"
import { copyText } from "../clipboard"
import {
  addHistory,
  addShownNow,
  addWhenSettled,
  clearHistory,
  listHistory,
  settleNow,
} from "../history"
import { activeHost, activePage, popupOnly } from "./request-context"
import { generatorKind, requireText } from "./validation"

export function generatorHandlers() {
  return {
    "generator.copy": {
      allow: popupOnly,
      handle: async ({ password }) => {
        requireText(password, "password")
        await copyText(password, true)
        const { page } = await activePage()
        await addHistory(password, page?.hostname ?? null)
        return null
      },
    },
    "generator.record": {
      allow: popupOnly,
      handle: async ({ password, site }) => {
        requireText(password, "password")
        const host = normalizeSiteInput(requireText(site, "site"))?.hostname
        await addHistory(password, host ?? null)
        return null
      },
    },
    "generator.shown": {
      allow: popupOnly,
      handle: async ({ value, kind, copied }) => {
        requireText(value, "value")
        const checkedKind = generatorKind(kind)
        if (copied === true) {
          await addShownNow(value, checkedKind, await activeHost())
        } else {
          // Nothing is awaited before this, so values wait to settle in the order the popup showed them.
          addWhenSettled(value, checkedKind, activeHost)
        }
        return null
      },
    },
    "history.list": {
      allow: popupOnly,
      handle: async () => {
        await settleNow()
        return listHistory()
      },
    },
    "history.copy": {
      allow: popupOnly,
      handle: async ({ id }) => {
        const entry = (await listHistory()).find((e) => e.id === id)
        if (!entry) throw new VaultError("Unknown entry", "notFound")
        // A username is not a secret, so it stays on the clipboard.
        await copyText(entry.value, entry.kind !== "username")
        return null
      },
    },
    "history.clear": {
      allow: popupOnly,
      handle: async () => {
        await clearHistory()
        return null
      },
    },
  } satisfies Partial<Handlers<BackgroundApi>>
}

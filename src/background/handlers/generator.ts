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
import { activeHost, popupOnly } from "./request-context"
import { generatorKind, requireText } from "./validation"

export function generatorHandlers() {
  return {
    "generator.copy": {
      allow: popupOnly,
      handle: async ({ password }) => {
        const checkedPassword = requireText(password, "password")
        await copyText(checkedPassword, true)
        await addHistory(checkedPassword, await activeHost())
        return null
      },
    },
    "generator.record": {
      allow: popupOnly,
      handle: async ({ password, site }) => {
        const checkedPassword = requireText(password, "password")
        const host = normalizeSiteInput(requireText(site, "site"))?.hostname
        await addHistory(checkedPassword, host ?? null)
        return null
      },
    },
    "generator.shown": {
      allow: popupOnly,
      handle: async ({ value, kind, copied }) => {
        const checkedValue = requireText(value, "value")
        const checkedKind = generatorKind(kind)
        if (copied === true) {
          await addShownNow(checkedValue, checkedKind, await activeHost())
        } else {
          // Nothing is awaited before this, so values wait to settle in the order the popup showed them.
          addWhenSettled(checkedValue, checkedKind, activeHost)
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
        const entry = (await listHistory()).find(
          (candidate) => candidate.id === id,
        )
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

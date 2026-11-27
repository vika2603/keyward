import {
  createForwardedAlias,
  type ForwardingService,
  isForwardingService,
} from "@/lib/email-forwarding"
import type { Handlers } from "@/lib/messaging"
import { VaultError } from "@/lib/providers/types"
import type { BackgroundApi } from "../api"
import { copyText } from "../clipboard"
import type { ForwardingStore } from "../forwarding"
import {
  addHistory,
  addShownNow,
  addWhenSettled,
  clearHistory,
  listHistory,
  settleNow,
} from "../history"
import { activeHost, popupOnly } from "./request-context"
import {
  forwardingSettings,
  generatorKind,
  optionalText,
  requireText,
  siteInput,
} from "./validation"

function forwardingService(value: unknown): ForwardingService {
  if (!isForwardingService(value))
    throw new VaultError("Unknown forwarding service", "invalidInput")
  return value
}

export function generatorHandlers(forwarding: ForwardingStore) {
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
        const host = siteInput(site)?.hostname
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
    "generator.forwarding": {
      allow: popupOnly,
      handle: ({ accountId }) =>
        forwarding.view(optionalText(accountId, "accountId") ?? undefined),
    },
    "generator.saveForwarding": {
      allow: popupOnly,
      handle: async ({ accountId, service, settings }) => {
        await forwarding.save(
          forwardingService(service),
          forwardingSettings(settings),
          optionalText(accountId, "accountId") ?? undefined,
        )
        return null
      },
    },
    "generator.forwardedEmail": {
      allow: popupOnly,
      handle: async ({ service, accountId }) => {
        const checkedService = forwardingService(service)
        const settings = await forwarding.settings(
          checkedService,
          optionalText(accountId, "accountId") ?? undefined,
        )
        const host = await activeHost()
        const alias = await createForwardedAlias({
          service: checkedService,
          apiKey: settings.apiKey,
          domain: settings.domain || undefined,
          baseUrl: settings.baseUrl || undefined,
          website: host ?? undefined,
        })
        await addShownNow(alias, "username", host)
        return { alias }
      },
    },
  } satisfies Partial<Handlers<BackgroundApi>>
}

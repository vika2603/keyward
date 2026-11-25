import type { Handlers } from "@/lib/messaging"
import type { BackgroundApi } from "../api"
import { contentConfig, hasCodes, notePasskeyUsed } from "../autofill"
import { offerCandidate } from "../code-setup"
import { menus } from "../overlays"
import type { Providers } from "../providers"
import { onSubmitted, showPrompt } from "../save-flow"
import { closeMenu, tabFrame } from "./request-context"
import { fieldKind, requireText } from "./validation"

export function contentHandlers(providers: Providers) {
  return {
    "content.codeCandidate": {
      allow: ["contentScript"],
      handle: (candidate, sender) => {
        const { tabId, frameId } = tabFrame(sender)
        return offerCandidate(tabId, frameId, candidate ?? {})
      },
    },
    "content.init": {
      allow: ["contentScript"],
      handle: (_, sender) => {
        const { tabId, frameId } = tabFrame(sender)
        return contentConfig(providers, tabId, frameId)
      },
    },
    "content.openMenu": {
      allow: ["contentScript"],
      handle: async ({ kind, newPassword, passkey }, sender) => {
        const { tabId, frameId } = tabFrame(sender)
        const open = await menus.get(tabId)
        if (open && open.frameId !== frameId) await closeMenu(tabId)
        const token = crypto.randomUUID()
        await menus.set({
          tabId,
          frameId,
          token,
          overlayFrameId: null,
          kind: fieldKind(kind),
          newPassword: newPassword === true,
          passkey: passkey === true && fieldKind(kind) === "login",
        })
        return { token }
      },
    },
    "content.hasCodes": {
      allow: ["contentScript"],
      handle: (_, sender) => {
        const { tabId, frameId } = tabFrame(sender)
        return hasCodes(providers, tabId, frameId)
      },
    },
    "content.passkeyUsed": {
      allow: ["contentScript"],
      handle: async (_, sender) => {
        const { tabId, frameId } = tabFrame(sender)
        await notePasskeyUsed(tabId, frameId)
        return null
      },
    },
    "content.closeMenu": {
      allow: ["contentScript"],
      handle: async (_, sender) => {
        const { tabId, frameId } = tabFrame(sender)
        if ((await menus.get(tabId))?.frameId === frameId)
          await menus.remove(tabId)
        return null
      },
    },
    "content.submitted": {
      allow: ["contentScript"],
      handle: async ({ username, password, newPassword }, sender) => {
        const { tabId, frameId } = tabFrame(sender)
        await onSubmitted(providers, tabId, frameId, {
          username: requireText(username, "username"),
          password: requireText(password, "password"),
          newPassword: newPassword === true,
        })
        return null
      },
    },
    "content.ready": {
      allow: ["contentScript"],
      handle: async (_, sender) => {
        const { tabId, frameId } = tabFrame(sender)
        if (frameId === 0) await showPrompt(tabId)
        return null
      },
    },
  } satisfies Partial<Handlers<BackgroundApi>>
}

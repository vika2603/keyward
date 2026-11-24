import { normalizeServerAddress } from "@/lib/backends/bitwarden/server"
import { isBitwardenSource } from "@/lib/backends/bitwarden/source-id"
import { BackendError } from "@/lib/backends/types"
import type { Handlers, Sender } from "@/lib/messaging"
import { getSettings, updateSettings } from "@/lib/settings"
import { normalizeSiteInput } from "@/lib/site"
import type { BackgroundApi, PopupView } from "./api"
import { contentConfig, fillLogin } from "./autofill"
import type { Backends } from "./backends"
import { copyText } from "./clipboard"
import { addHistory, clearHistory, listHistory } from "./history"
import { menus, prompts } from "./overlays"
import { activeTab, frameUrl, sendToFrame, webPage } from "./page"
import {
  closePrompt,
  confirmPrompt,
  defaultTarget,
  neverForSite,
  onSubmitted,
  promptState,
  showPrompt,
} from "./save-flow"

const POPUP_VIEW_KEY = "popup.view"
const MAX_GENERATED_LENGTH = 128

function tabFrame(sender: Sender): { tabId: number; frameId: number } {
  if (sender.tab?.id === undefined || sender.frameId === undefined) {
    throw new BackendError("The request has no tab", "forbidden")
  }
  return { tabId: sender.tab.id, frameId: sender.frameId }
}

function requireText(value: unknown, name: string, maxLength = 1024): string {
  if (typeof value !== "string" || value.length > maxLength) {
    throw new BackendError(`Invalid ${name}`, "invalidInput")
  }
  return value
}

/** Opens the toolbar popup on a given view, in a popup window when the browser refuses. */
export async function openPopup(view: PopupView): Promise<void> {
  await browser.storage.session.set({ [POPUP_VIEW_KEY]: view })
  try {
    await browser.action.openPopup()
  } catch {
    await browser.windows.create({
      url: browser.runtime.getURL("/popup.html"),
      type: "popup",
      width: 400,
      height: 600,
    })
  }
}

async function closeMenu(tabId: number): Promise<void> {
  const session = await menus.get(tabId)
  if (!session) return
  await menus.remove(tabId)
  await sendToFrame(tabId, session.frameId, { type: "menu.close" }).catch(
    () => {},
  )
}

async function activePage(): Promise<{
  tabId: number | undefined
  page: URL | null
}> {
  const tab = await activeTab()
  return { tabId: tab?.id, page: webPage(tab?.url) }
}

export function createHandlers(backends: Backends): Handlers<BackgroundApi> {
  const { apple, bitwarden } = backends
  const popup = ["popup"] as const
  const connectPages = ["popup", "options"] as const

  return {
    "popup.state": {
      allow: popup,
      handle: async () => {
        const { page } = await activePage()
        return {
          page: page ? { url: page.href, host: page.hostname } : null,
          sources: await backends.loginsForPage(page),
        }
      },
    },
    "popup.takeView": {
      allow: popup,
      handle: async () => {
        const stored = (await browser.storage.session.get(POPUP_VIEW_KEY))[
          POPUP_VIEW_KEY
        ]
        await browser.storage.session.remove(POPUP_VIEW_KEY)
        if (stored) return stored as PopupView
        if (apple.getState().phase === "awaitingCode")
          return { name: "connect", kind: "apple" }
        return { name: "main" }
      },
    },
    "popup.copyPassword": {
      allow: popup,
      handle: async ({ sourceId, loginId }) => {
        const { tabId, page } = await activePage()
        if (!page || tabId === undefined)
          throw new BackendError("No web page is open", "notWebPage")
        const credential = await backends
          .backendOf(sourceId)
          .credential(sourceId, loginId, page, { tabId, frameId: 0 })
        await copyText(credential.password, true)
        return null
      },
    },
    "popup.copyText": {
      allow: popup,
      handle: async ({ text }) => {
        await copyText(requireText(text, "text"), false)
        return null
      },
    },
    "popup.saveTargets": {
      allow: popup,
      handle: async () => {
        const targets = await backends.savable()
        return { targets, defaultTarget: await defaultTarget(targets) }
      },
    },
    "popup.saveLogin": {
      allow: popup,
      handle: async ({ sourceId, site, username, password }) => {
        const url = normalizeSiteInput(requireText(site, "site"))
        if (!url) throw new BackendError("Not a web address", "invalidSite")
        if (!requireText(password, "password"))
          throw new BackendError("Empty password", "invalidInput")
        if (!(await backends.savable()).some((s) => s.id === sourceId)) {
          throw new BackendError(
            "The chosen place is not available",
            "unknownSource",
          )
        }
        const { tabId } = await activePage()
        await backends.backendOf(sourceId).save(
          sourceId,
          { url, username: requireText(username, "username").trim(), password },
          {
            tabId: tabId ?? 0,
            frameId: 0,
          },
        )
        return null
      },
    },

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
          throw new BackendError("The code has six digits", "invalidInput")
        }
        await apple.submitCode(code)
        return apple.getState()
      },
    },
    "apple.openPasswordsApp": {
      allow: connectPages,
      handle: async () => {
        await apple.openPasswordsApp()
        return null
      },
    },

    "bitwarden.accounts": {
      allow: connectPages,
      handle: () => bitwarden.accounts(),
    },
    "bitwarden.unlock": {
      allow: connectPages,
      handle: async ({ accountId, password }) => {
        await bitwarden.unlock(accountId, requireText(password, "password"))
        return null
      },
    },
    "bitwarden.signOut": {
      allow: ["options"],
      handle: async ({ accountId }) => {
        await bitwarden.signOut(accountId)
        return null
      },
    },
    "bitwarden.signIn": {
      allow: connectPages,
      handle: ({ server, email, password }) =>
        bitwarden.signIn(
          normalizeServerAddress(requireText(server, "server")),
          {
            email: requireText(email, "email").trim(),
            password: requireText(password, "password"),
          },
        ),
    },
    "bitwarden.pendingSignIn": {
      allow: connectPages,
      handle: () => bitwarden.pendingSignIn(),
    },
    "bitwarden.sendEmailCode": {
      allow: connectPages,
      handle: async () => {
        await bitwarden.sendEmailCode()
        return null
      },
    },
    "bitwarden.submitSecondStep": {
      allow: connectPages,
      handle: async ({ method, code }) => ({
        accountId: await bitwarden.submitSecondStep(
          method,
          requireText(code, "code", 128),
        ),
      }),
    },
    "bitwarden.cancelSignIn": {
      allow: connectPages,
      handle: async () => {
        await bitwarden.cancelSignIn()
        return null
      },
    },

    "generator.copy": {
      allow: popup,
      handle: async ({ password }) => {
        requireText(password, "password", MAX_GENERATED_LENGTH)
        await copyText(password, true)
        const { page } = await activePage()
        await addHistory(password, page?.hostname ?? null)
        return null
      },
    },
    "generator.record": {
      allow: popup,
      handle: async ({ password, site }) => {
        requireText(password, "password", MAX_GENERATED_LENGTH)
        const host = normalizeSiteInput(requireText(site, "site"))?.hostname
        await addHistory(password, host ?? null)
        return null
      },
    },
    "history.list": { allow: popup, handle: () => listHistory() },
    "history.copy": {
      allow: popup,
      handle: async ({ id }) => {
        const entry = (await listHistory()).find((e) => e.id === id)
        if (!entry) throw new BackendError("Unknown entry", "notFound")
        await copyText(entry.password, true)
        return null
      },
    },
    "history.clear": {
      allow: popup,
      handle: async () => {
        await clearHistory()
        return null
      },
    },

    "menu.state": {
      allow: ["menu"],
      handle: async ({ token }, sender) => {
        const session = await menus.claim(sender, token)
        const page = await frameUrl(session.tabId, session.frameId)
        if (!page)
          throw new BackendError("The frame is not a web page", "notWebPage")
        return {
          host: page.hostname,
          sources: await backends.loginsForPage(page),
        }
      },
    },
    "menu.fill": {
      allow: ["menu"],
      handle: async ({ token, sourceId, loginId }, sender) => {
        const session = await menus.claim(sender, token)
        await fillLogin(
          backends,
          session.tabId,
          session.frameId,
          sourceId,
          loginId,
        )
        await closeMenu(session.tabId)
        return null
      },
    },
    "menu.resize": {
      allow: ["menu"],
      handle: async ({ token, height }, sender) => {
        const session = await menus.claim(sender, token)
        await sendToFrame(session.tabId, session.frameId, {
          type: "menu.resize",
          height: Number(height),
        })
        return null
      },
    },
    "menu.close": {
      allow: ["menu"],
      handle: async ({ token }, sender) => {
        await closeMenu((await menus.claim(sender, token)).tabId)
        return null
      },
    },
    "menu.connect": {
      allow: ["menu"],
      handle: async ({ token, sourceId }, sender) => {
        const session = await menus.claim(sender, token)
        const kind = isBitwardenSource(sourceId) ? "bitwarden" : "apple"
        await closeMenu(session.tabId)
        await openPopup({ name: "connect", kind, sourceId })
        return null
      },
    },

    "prompt.state": {
      allow: ["savePrompt"],
      handle: async ({ token }, sender) =>
        promptState(backends, (await prompts.claim(sender, token)).tabId),
    },
    "prompt.confirm": {
      allow: ["savePrompt"],
      handle: async ({ token, targetId }, sender) => {
        await confirmPrompt(
          backends,
          (await prompts.claim(sender, token)).tabId,
          targetId,
        )
        return null
      },
    },
    "prompt.never": {
      allow: ["savePrompt"],
      handle: async ({ token }, sender) => {
        await neverForSite((await prompts.claim(sender, token)).tabId)
        return null
      },
    },
    "prompt.close": {
      allow: ["savePrompt"],
      handle: async ({ token }, sender) => {
        await closePrompt((await prompts.claim(sender, token)).tabId)
        return null
      },
    },
    "prompt.resize": {
      allow: ["savePrompt"],
      handle: async ({ token, height }, sender) => {
        const session = await prompts.claim(sender, token)
        await sendToFrame(session.tabId, session.frameId, {
          type: "prompt.resize",
          height: Number(height),
        })
        return null
      },
    },

    "content.init": {
      allow: ["contentScript"],
      handle: (_, sender) => {
        const { tabId, frameId } = tabFrame(sender)
        return contentConfig(backends, tabId, frameId)
      },
    },
    "content.openMenu": {
      allow: ["contentScript"],
      handle: async (_, sender) => {
        const { tabId, frameId } = tabFrame(sender)
        const open = await menus.get(tabId)
        if (open && open.frameId !== frameId) await closeMenu(tabId)
        const token = crypto.randomUUID()
        await menus.set({ tabId, frameId, token, overlayFrameId: null })
        return { token }
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
      handle: async ({ username, password }, sender) => {
        const { tabId, frameId } = tabFrame(sender)
        await onSubmitted(backends, tabId, frameId, {
          username: requireText(username, "username"),
          password: requireText(password, "password"),
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
  }
}

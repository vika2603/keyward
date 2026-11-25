import { normalizeServerAddress } from "@/lib/backends/bitwarden/server"
import { isBitwardenSource } from "@/lib/backends/bitwarden/source-id"
import { BackendError, type LoginEdit, type TabRef } from "@/lib/backends/types"
import { generatePassword, generatorOptionsItem } from "@/lib/generator"
import type { Handlers, Sender } from "@/lib/messaging"
import { getSettings, updateSettings } from "@/lib/settings"
import { normalizeSiteInput, siteDomainOf } from "@/lib/site"
import { keyLabel } from "@/lib/totp"
import type { BackgroundApi, FieldKind, PopupView, SourceView } from "./api"
import {
  contentConfig,
  fillCode,
  fillLogin,
  fillNewPassword,
  hasCodes,
} from "./autofill"
import type { Backends } from "./backends"
import { copyText } from "./clipboard"
import { finishSetup, offerCandidate, pendingSetup } from "./code-setup"
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
  recallUsername,
  saveTargets,
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

/**
 * Puts the login signed in with moments ago first, in its source and among the sources, so its
 * code is the first one offered.
 */
export function markRecent(
  sources: SourceView[],
  username: string | null,
): SourceView[] {
  const name = username?.trim().toLowerCase()
  if (!name) return sources
  const marked = sources.map((source) => {
    const logins = source.logins.map((login) =>
      login.username.trim().toLowerCase() === name
        ? { ...login, recent: true }
        : login,
    )
    return {
      ...source,
      logins: [
        ...logins.filter((l) => l.recent),
        ...logins.filter((l) => !l.recent),
      ],
    }
  })
  return [
    ...marked.filter((s) => s.logins.some((l) => l.recent)),
    ...marked.filter((s) => !s.logins.some((l) => l.recent)),
  ]
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

/** The tab a popup read is reported for; Apple's helper only uses it to route its reply. */
async function popupTab(): Promise<TabRef> {
  const tab = await activeTab()
  return { tabId: tab?.id ?? 0, frameId: 0 }
}

function notEditable(): BackendError {
  return new BackendError("The login cannot be changed", "notEditable")
}

const MAX_URIS = 50

/** The fields of an edit, checked; fields that are left out stay out. */
function loginEdit(value: unknown): LoginEdit {
  if (typeof value !== "object" || value === null)
    throw new BackendError("Invalid change", "invalidInput")
  const input = value as Record<string, unknown>
  const edit: LoginEdit = {}
  const limits = {
    name: 1024,
    username: 1024,
    password: 1024,
    notes: 10_000,
    totp: 4096,
  } as const
  for (const [key, max] of Object.entries(limits) as [
    keyof typeof limits,
    number,
  ][]) {
    if (input[key] !== undefined) edit[key] = requireText(input[key], key, max)
  }
  if (input.uris !== undefined) {
    if (!Array.isArray(input.uris) || input.uris.length > MAX_URIS)
      throw new BackendError("Invalid addresses", "invalidInput")
    edit.uris = input.uris.map((uri) => requireText(uri, "uri", 2048))
  }
  return edit
}

function fieldKind(value: unknown): FieldKind {
  if (value !== "login" && value !== "code")
    throw new BackendError("Invalid field kind", "invalidInput")
  return value
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
    "popup.search": {
      allow: popup,
      handle: ({ query }) => backends.search(requireText(query, "query", 256)),
    },
    "popup.copyPassword": {
      allow: popup,
      handle: async ({ sourceId, loginId }) => {
        const credential = await backends
          .backendOf(sourceId)
          .credential(sourceId, loginId, null, await popupTab())
        await copyText(credential.password, true)
        return null
      },
    },
    "popup.copyText": {
      allow: popup,
      handle: async ({ text, secret }) => {
        await copyText(requireText(text, "text", 8192), secret === true)
        return null
      },
    },
    "popup.details": {
      allow: popup,
      handle: ({ sourceId, loginId }) =>
        backends.backendOf(sourceId).details(sourceId, loginId, null),
    },
    "popup.revealPassword": {
      allow: popup,
      handle: async ({ sourceId, loginId }) => {
        const { password } = await backends
          .backendOf(sourceId)
          .credential(sourceId, loginId, null, await popupTab())
        return { password }
      },
    },
    "popup.oneTimeCode": {
      allow: popup,
      handle: async ({ sourceId, loginId }) =>
        backends
          .backendOf(sourceId)
          .oneTimeCode(sourceId, loginId, null, await popupTab()),
    },
    "popup.editable": {
      allow: popup,
      handle: ({ sourceId, loginId }) => {
        const backend = backends.backendOf(sourceId)
        if (!backend.editable) throw notEditable()
        return backend.editable(sourceId, requireText(loginId, "loginId"))
      },
    },
    "popup.editLogin": {
      allow: popup,
      handle: async ({ sourceId, loginId, change }) => {
        const backend = backends.backendOf(sourceId)
        if (!backend.edit) throw notEditable()
        await backend.edit(
          sourceId,
          requireText(loginId, "loginId"),
          loginEdit(change),
        )
        return null
      },
    },
    "popup.removeLogin": {
      allow: popup,
      handle: async ({ sourceId, loginId }) => {
        const backend = backends.backendOf(sourceId)
        if (!backend.remove) throw notEditable()
        await backend.remove(sourceId, requireText(loginId, "loginId"))
        return null
      },
    },
    "popup.codeSetup": {
      allow: popup,
      handle: async () => {
        const { uri, page } = await pendingSetup()
        const sources = await backends.loginsForPage(page)
        return {
          host: page.hostname,
          ...keyLabel(uri),
          apple: apple.canSetUpCodes() && apple.canSave(page),
          sources: sources.filter(
            (s) => s.kind === "bitwarden" && s.status === "ready" && !s.error,
          ),
        }
      },
    },
    "popup.setUpCode": {
      allow: popup,
      handle: async ({ sourceId, loginId }) => {
        const { uri, page } = await pendingSetup()
        if (backends.backendOf(requireText(sourceId, "sourceId")) === apple) {
          if (!apple.canSave(page))
            throw new BackendError(
              "Apple Passwords does not store logins for this host",
              "apple.unsupportedSite",
            )
          await apple.setUpCode(page.hostname, uri)
        } else {
          await bitwarden.setCode(
            sourceId,
            requireText(loginId, "loginId"),
            page,
            uri,
          )
        }
        await finishSetup()
        return null
      },
    },
    "popup.lock": {
      allow: popup,
      handle: async ({ sourceId }) => {
        const id = requireText(sourceId, "sourceId")
        await backends.backendOf(id).lock(id)
        return null
      },
    },
    "popup.lockAll": {
      allow: popup,
      handle: async () => {
        await backends.lockAll()
        return null
      },
    },
    "popup.saveTargets": {
      allow: popup,
      handle: async ({ site }) => {
        const ready = await backends.savable()
        const url = normalizeSiteInput(requireText(site, "site", 2048))
        const targets = url ? await saveTargets(backends, url) : ready
        return {
          targets,
          defaultTarget: await defaultTarget(targets),
          unsupported: url
            ? ready.filter((s) => !backends.backendOf(s.id).canSave(url))
            : [],
        }
      },
    },
    "popup.saveLogin": {
      allow: popup,
      handle: async ({ sourceId, site, username, password }) => {
        const url = normalizeSiteInput(requireText(site, "site"))
        if (!url) throw new BackendError("Not a web address", "invalidSite")
        if (!requireText(password, "password"))
          throw new BackendError("Empty password", "invalidInput")
        if (
          !(await saveTargets(backends, url)).some((s) => s.id === sourceId)
        ) {
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
      handle: async ({ site }) => {
        await apple.openPasswordsApp(
          site === undefined ? undefined : requireText(site, "site", 253),
        )
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
        const kind = session.kind ?? "login"
        if (kind === "login") {
          let suggestion = session.suggestion
          if (session.newPassword && !suggestion) {
            suggestion = generatePassword(await generatorOptionsItem.getValue())
            await menus.set({ ...session, suggestion })
          }
          return {
            host: page.hostname,
            kind,
            sources: await backends.fillableForPage(page),
            ...(suggestion ? { suggestion } : {}),
          }
        }
        const sources = await backends.codeLoginsForPage(page, {
          tabId: session.tabId,
          frameId: session.frameId,
        })
        const recent = await recallUsername(
          session.tabId,
          siteDomainOf(page.hostname),
        )
        return {
          host: page.hostname,
          kind,
          sources: markRecent(sources, recent),
        }
      },
    },
    "menu.fill": {
      allow: ["menu"],
      handle: async ({ token, sourceId, loginId }, sender) => {
        const session = await menus.claim(sender, token)
        const fill = session.kind === "code" ? fillCode : fillLogin
        await fill(backends, session.tabId, session.frameId, sourceId, loginId)
        await closeMenu(session.tabId)
        return null
      },
    },
    "menu.fillSuggestion": {
      allow: ["menu"],
      handle: async ({ token }, sender) => {
        const session = await menus.claim(sender, token)
        if (!session.suggestion)
          throw new BackendError("No password is offered", "invalidInput")
        await fillNewPassword(
          session.tabId,
          session.frameId,
          session.suggestion,
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
        return contentConfig(backends, tabId, frameId)
      },
    },
    "content.openMenu": {
      allow: ["contentScript"],
      handle: async ({ kind, newPassword }, sender) => {
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
        })
        return { token }
      },
    },
    "content.hasCodes": {
      allow: ["contentScript"],
      handle: (_, sender) => {
        const { tabId, frameId } = tabFrame(sender)
        return hasCodes(backends, tabId, frameId)
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

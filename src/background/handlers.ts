import { generatePassword, generatorOptionsItem } from "@/lib/generator"
import type { Handlers, Sender } from "@/lib/messaging"
import { normalizeServerAddress } from "@/lib/providers/bitwarden/server"
import { isBitwardenVault } from "@/lib/providers/bitwarden/vault-id"
import {
  type CustomField,
  type LoginEdit,
  type TabRef,
  VaultError,
} from "@/lib/providers/types"
import { getSettings, updateSettings } from "@/lib/settings"
import { normalizeSiteInput, siteDomainOf } from "@/lib/site"
import { keyLabel } from "@/lib/totp"
import type { BackgroundApi, FieldKind, PopupView } from "./api"
import {
  contentConfig,
  fillCode,
  fillLogin,
  fillNewPassword,
  hasCodes,
  notePasskeyUsed,
} from "./autofill"
import { copyText } from "./clipboard"
import { finishSetup, offerCandidate, pendingSetup } from "./code-setup"
import { addHistory, clearHistory, listHistory } from "./history"
import { menus, prompts } from "./overlays"
import { activeTab, frameUrl, sendToFrame, webPage } from "./page"
import type { Providers } from "./providers"
import {
  closePrompt,
  confirmPrompt,
  defaultTarget,
  markRecent,
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
    throw new VaultError("The request has no tab", "forbidden")
  }
  return { tabId: sender.tab.id, frameId: sender.frameId }
}

function requireText(value: unknown, name: string, maxLength = 1024): string {
  if (typeof value !== "string" || value.length > maxLength) {
    throw new VaultError(`Invalid ${name}`, "invalidInput")
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

function notEditable(): VaultError {
  return new VaultError("The login cannot be changed", "notEditable")
}

const MAX_URIS = 50

/** The fields of an edit, checked; fields that are left out stay out. */
function loginEdit(value: unknown): LoginEdit {
  if (typeof value !== "object" || value === null)
    throw new VaultError("Invalid change", "invalidInput")
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
      throw new VaultError("Invalid addresses", "invalidInput")
    edit.uris = input.uris.map((uri) => requireText(uri, "uri", 2048))
  }
  if (input.customFields !== undefined)
    edit.customFields = customFieldsInput(input.customFields)
  return edit
}

const MAX_CUSTOM_FIELDS = 100

function customFieldsInput(value: unknown): CustomField[] {
  if (!Array.isArray(value) || value.length > MAX_CUSTOM_FIELDS)
    throw new VaultError("Invalid custom fields", "invalidInput")
  return value.map(customFieldInput)
}

function customFieldInput(value: unknown): CustomField {
  const invalid = new VaultError("Invalid custom field", "invalidInput")
  if (typeof value !== "object" || value === null) throw invalid
  const field = value as Record<string, unknown>
  const name = requireText(field.name, "field name")
  switch (field.kind) {
    case "text":
    case "hidden":
      return {
        kind: field.kind,
        name,
        value: requireText(field.value, "field value", 5000),
      }
    case "checkbox":
      if (typeof field.checked !== "boolean") throw invalid
      return { kind: "checkbox", name, checked: field.checked }
    case "linked":
      if (field.linkedTo !== "username" && field.linkedTo !== "password")
        throw invalid
      return { kind: "linked", name, linkedTo: field.linkedTo }
    default:
      throw invalid
  }
}

function fieldKind(value: unknown): FieldKind {
  if (value !== "login" && value !== "code")
    throw new VaultError("Invalid field kind", "invalidInput")
  return value
}

export function createHandlers(providers: Providers): Handlers<BackgroundApi> {
  const { apple, bitwarden } = providers
  const popup = ["popup"] as const
  const connectPages = ["popup", "options"] as const

  return {
    "popup.state": {
      allow: popup,
      handle: async () => {
        const { page } = await activePage()
        return {
          page: page ? { url: page.href, host: page.hostname } : null,
          vaults: await providers.loginsForPage(page),
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
      handle: ({ query }) => providers.search(requireText(query, "query", 256)),
    },
    "popup.copyPassword": {
      allow: popup,
      handle: async ({ vaultId, loginId }) => {
        const credential = await providers
          .providerOf(vaultId)
          .credential(vaultId, loginId, null, await popupTab())
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
      handle: ({ vaultId, loginId }) =>
        providers.providerOf(vaultId).details(vaultId, loginId, null),
    },
    "popup.revealPassword": {
      allow: popup,
      handle: async ({ vaultId, loginId }) => {
        const { password } = await providers
          .providerOf(vaultId)
          .credential(vaultId, loginId, null, await popupTab())
        return { password }
      },
    },
    "popup.oneTimeCode": {
      allow: popup,
      handle: async ({ vaultId, loginId }) =>
        providers
          .providerOf(vaultId)
          .oneTimeCode(vaultId, loginId, null, await popupTab()),
    },
    "popup.passwordHistory": {
      allow: popup,
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
      allow: popup,
      handle: ({ vaultId, loginId }) => {
        const provider = providers.providerOf(vaultId)
        if (!provider.editable) throw notEditable()
        return provider.editable(vaultId, requireText(loginId, "loginId"))
      },
    },
    "popup.editLogin": {
      allow: popup,
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
    "popup.removeLogin": {
      allow: popup,
      handle: async ({ vaultId, loginId }) => {
        const provider = providers.providerOf(vaultId)
        if (!provider.remove) throw notEditable()
        await provider.remove(vaultId, requireText(loginId, "loginId"))
        return null
      },
    },
    "popup.codeSetup": {
      allow: popup,
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
      allow: popup,
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
    "popup.lock": {
      allow: popup,
      handle: async ({ vaultId }) => {
        const id = requireText(vaultId, "vaultId")
        await providers.providerOf(id).lock(id)
        return null
      },
    },
    "popup.lockAll": {
      allow: popup,
      handle: async () => {
        await providers.lockAll()
        return null
      },
    },
    "popup.saveTargets": {
      allow: popup,
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
      allow: popup,
      handle: async ({ vaultId, site, username, password }) => {
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
          throw new VaultError("The code has six digits", "invalidInput")
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
        if (!entry) throw new VaultError("Unknown entry", "notFound")
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
          throw new VaultError("The frame is not a web page", "notWebPage")
        const kind = session.kind ?? "login"
        // The account this tab used on the site moments ago comes first: the password step of a
        // two-step login, or the code step after a password.
        const recent = await recallUsername(
          session.tabId,
          siteDomainOf(page.hostname),
        )
        if (kind === "login") {
          let suggestion = session.suggestion
          if (session.newPassword && !suggestion) {
            suggestion = generatePassword(await generatorOptionsItem.getValue())
            await menus.set({ ...session, suggestion })
          }
          return {
            host: page.hostname,
            kind,
            vaults: markRecent(await providers.loginsForPage(page), recent),
            ...(suggestion ? { suggestion } : {}),
            ...(session.passkey ? { passkey: true } : {}),
          }
        }
        const vaults = await providers.codeLoginsForPage(page, {
          tabId: session.tabId,
          frameId: session.frameId,
        })
        return {
          host: page.hostname,
          kind,
          vaults: markRecent(vaults, recent),
        }
      },
    },
    "menu.fill": {
      allow: ["menu"],
      handle: async ({ token, vaultId, loginId }, sender) => {
        const session = await menus.claim(sender, token)
        const fill = session.kind === "code" ? fillCode : fillLogin
        await fill(providers, session.tabId, session.frameId, vaultId, loginId)
        await closeMenu(session.tabId)
        return null
      },
    },
    "menu.fillSuggestion": {
      allow: ["menu"],
      handle: async ({ token }, sender) => {
        const session = await menus.claim(sender, token)
        if (!session.suggestion)
          throw new VaultError("No password is offered", "invalidInput")
        await fillNewPassword(
          session.tabId,
          session.frameId,
          session.suggestion,
        )
        await closeMenu(session.tabId)
        return null
      },
    },
    "menu.usePasskey": {
      allow: ["menu"],
      handle: async ({ token }, sender) => {
        const session = await menus.claim(sender, token)
        if (!session.passkey)
          throw new VaultError("No passkey sign-in is offered", "invalidInput")
        await sendToFrame(session.tabId, session.frameId, {
          type: "usePasskey",
        })
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
      handle: async ({ token, vaultId }, sender) => {
        const session = await menus.claim(sender, token)
        const kind = isBitwardenVault(vaultId) ? "bitwarden" : "apple"
        await closeMenu(session.tabId)
        await openPopup({ name: "connect", kind, vaultId })
        return null
      },
    },

    "prompt.state": {
      allow: ["savePrompt"],
      handle: async ({ token }, sender) =>
        promptState(providers, (await prompts.claim(sender, token)).tabId),
    },
    "prompt.confirm": {
      allow: ["savePrompt"],
      handle: async ({ token, targetId }, sender) => {
        await confirmPrompt(
          providers,
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
  }
}

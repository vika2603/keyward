import { controlBrowserSaving } from "@/lib/browser-saving"
import { senderKind, serveRequests } from "@/lib/messaging"
import { AppleProvider } from "@/lib/providers/apple/apple-provider"
import { BitwardenProvider } from "@/lib/providers/bitwarden/bitwarden-provider"
import { loadVaultCrypto } from "@/lib/providers/bitwarden/sdk-loader"
import { getSettings, settingsItem } from "@/lib/settings"
import {
  APPLE_PAIRING_PORT,
  HTTP_AUTH_PORT,
  PASSKEY_PORT,
  VAULTS_CHANGED_KEY,
} from "./api"
import { fillFirst } from "./autofill"
import { CLEAR_CLIPBOARD_ALARM, clearClipboard } from "./clipboard"
import { watchCodeSetup } from "./code-setup"
import { errorCode } from "./error-code"
import { forgetFill } from "./filled-logins"
import { createHandlers } from "./handlers"
import { HttpAuth } from "./http-auth"
import { whenInstalled } from "./install"
import { LoginMenus } from "./login-menus"
import { menuSessions, promptSessions } from "./overlays"
import { PasskeyPrompt } from "./passkey-prompt"
import { openPopup } from "./popup-window"
import { Providers } from "./providers"
import { forgetGenerated } from "./recent-generated"
import { forgetUsername } from "./recent-usernames"
import { onSubmitted, refreshLockedPrompts } from "./save-prompt"
import { SubmissionGate } from "./submission-gate"
import { watchToolbar } from "./toolbar"

const AUTO_LOCK_ALARM = "autoLock"
/** Changes that come in a burst, such as an unlock and the sync after it, are announced once. */
const ANNOUNCE_DELAY_MS = 300

async function lockWhenSystemLocks(
  bitwarden: BitwardenProvider,
): Promise<void> {
  if ((await getSettings()).lockOnSystemLock) await bitwarden.lockAll()
}

async function runAlarm(
  name: string,
  bitwarden: BitwardenProvider,
): Promise<void> {
  if (name === AUTO_LOCK_ALARM) {
    const { autoLockMinutes } = await getSettings()
    if (autoLockMinutes !== null) await bitwarden.lockIdle(autoLockMinutes)
  } else if (name === CLEAR_CLIPBOARD_ALARM) {
    await clearClipboard()
  }
}

async function runCommand(
  command: string,
  providers: Providers,
): Promise<void> {
  switch (command) {
    case "fill-first": {
      // With nothing to fill, the popup shows why: vaults to unlock or pair, or no login for the site.
      if ((await fillFirst(providers)) === "noLogin")
        await openPopup({ name: "main" })
      return
    }
    case "open-generator":
      await openPopup({ name: "generator" })
      return
    case "lock-all":
      await providers.lockAll()
      return
  }
}

/** Wires the providers to messages, alarms and commands. Listeners are registered synchronously. */
export function startBackground(): void {
  const apple = new AppleProvider()
  const bitwarden = new BitwardenProvider(loadVaultCrypto)
  const providers = new Providers([apple, bitwarden])

  const httpAuth = new HttpAuth(providers, () =>
    openPopup({ name: "httpAuth" }),
  )
  const passkeyPrompt = new PasskeyPrompt(bitwarden, () =>
    openPopup({ name: "passkey" }),
  )
  const submissionGate = new SubmissionGate((tabId, frameId, submitted, page) =>
    onSubmitted(providers, tabId, frameId, submitted, page),
  )
  serveRequests(
    createHandlers(
      providers,
      { apple, bitwarden },
      httpAuth,
      submissionGate,
      passkeyPrompt,
    ),
    errorCode,
  )
  const submissionFilter = {
    urls: ["http://*/*", "https://*/*"],
    types: ["main_frame", "sub_frame", "xmlhttprequest"] as (
      | "main_frame"
      | "sub_frame"
      | "xmlhttprequest"
    )[],
  }
  browser.webRequest.onBeforeRequest.addListener((details) => {
    submissionGate.onBeforeRequest(details)
    return undefined
  }, submissionFilter)
  browser.webRequest.onBeforeRedirect.addListener((details) => {
    submissionGate.onBeforeRedirect(details)
  }, submissionFilter)
  browser.webRequest.onCompleted.addListener((details) => {
    submissionGate.onCompleted(details)
  }, submissionFilter)
  browser.webRequest.onErrorOccurred.addListener((details) => {
    submissionGate.onErrorOccurred(details)
  }, submissionFilter)
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    submissionGate.onTabUpdated(tabId, changeInfo.status)
  })
  // Only pages the user opens are answered: a request a page makes by itself would release a
  // login without the user seeing where it goes.
  browser.webRequest.onAuthRequired.addListener(
    (details, answer) => {
      void httpAuth.respond(details).then(answer, () => answer?.({}))
    },
    { urls: ["http://*/*", "https://*/*"], types: ["main_frame"] },
    ["asyncBlocking"],
  )
  const loginMenus = new LoginMenus(providers)
  const refreshToolbar = watchToolbar(providers, (vaults, tab) =>
    loginMenus.show(vaults, tab),
  )
  watchCodeSetup((view) => void openPopup(view).catch(() => {}))

  let announcing: ReturnType<typeof setTimeout> | undefined
  const announce = () => {
    clearTimeout(announcing)
    announcing = setTimeout(() => {
      void browser.storage.local.set({ [VAULTS_CHANGED_KEY]: Date.now() })
      void refreshLockedPrompts(providers).catch(() => {})
      refreshToolbar()
    }, ANNOUNCE_DELAY_MS)
  }
  let appleReady = false
  apple.helper.onChange((state) => {
    if ((state.phase === "paired") === appleReady) return
    appleReady = state.phase === "paired"
    announce()
  })
  bitwarden.onChange(announce)
  // A Passwords code added or removed changes which code fields get the icon.
  apple.helper.onCodesChanged(announce)

  let pairingViews = 0
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== HTTP_AUTH_PORT) return
    if (!port.sender || senderKind(port.sender) !== "popup") {
      port.disconnect()
      return
    }
    httpAuth.showing()
    port.onDisconnect.addListener(() => httpAuth.leave())
  })

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== PASSKEY_PORT) return
    if (!port.sender || senderKind(port.sender) !== "popup") {
      port.disconnect()
      return
    }
    passkeyPrompt.showing()
    port.onDisconnect.addListener(() => passkeyPrompt.leave())
  })

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== APPLE_PAIRING_PORT) return
    const kind = port.sender ? senderKind(port.sender) : null
    if (kind !== "popup") {
      port.disconnect()
      return
    }
    pairingViews++
    port.onDisconnect.addListener(() => {
      pairingViews--
      const viewsOpen = () => pairingViews > 0
      if (!viewsOpen())
        void apple.helper.cancelPairing(viewsOpen).catch(() => {})
    })
  })

  void getSettings().then((settings) => {
    void apple.helper.setEnabled(settings.appleEnabled)
    void controlBrowserSaving(settings.takeOverSaving).catch(() => {})
  })
  settingsItem.watch((next, previous) => {
    if (next?.appleEnabled !== previous?.appleEnabled)
      void apple.helper.setEnabled(Boolean(next?.appleEnabled))
    if (next?.takeOverSaving !== previous?.takeOverSaving)
      void controlBrowserSaving(next?.takeOverSaving ?? true).catch(() => {})
    // Turning a provider on or off and site rules change what the badge counts.
    refreshToolbar()
  })

  browser.idle.onStateChanged.addListener((state) => {
    if (state === "locked") void lockWhenSystemLocks(bitwarden).catch(() => {})
  })

  void browser.alarms.create(AUTO_LOCK_ALARM, { periodInMinutes: 1 })
  browser.alarms.onAlarm.addListener((alarm) => {
    void runAlarm(alarm.name, bitwarden).catch(() => {})
  })

  browser.commands.onCommand.addListener((command) => {
    void runCommand(command, providers).catch(() => {})
  })

  browser.runtime.onInstalled.addListener(({ reason }) => {
    void whenInstalled(reason, () => apple.helper.checkSetup())
  })

  browser.tabs.onRemoved.addListener((tabId) => {
    submissionGate.cancel(tabId)
    forgetFill(tabId)
    void forgetUsername(tabId)
    void forgetGenerated(tabId)
    void promptSessions.remove(tabId)
    void menuSessions.remove(tabId)
  })
}

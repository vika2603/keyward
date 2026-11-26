import { controlBrowserSaving } from "@/lib/browser-saving"
import { senderKind, serveRequests } from "@/lib/messaging"
import { AppleProvider } from "@/lib/providers/apple/apple-provider"
import { BitwardenProvider } from "@/lib/providers/bitwarden/bitwarden-provider"
import { loadVaultCrypto } from "@/lib/providers/bitwarden/sdk-loader"
import { getSettings, settingsItem } from "@/lib/settings"
import { APPLE_PAIRING_PORT, VAULTS_CHANGED_KEY } from "./api"
import { fillFirst } from "./autofill"
import { CLEAR_CLIPBOARD_ALARM, clearClipboard } from "./clipboard"
import { watchCodeSetup } from "./code-setup"
import { errorCode } from "./error-code"
import { createHandlers } from "./handlers"
import { LoginMenus } from "./login-menus"
import { menuSessions, promptSessions } from "./overlays"
import { openPopup } from "./popup-window"
import { Providers } from "./providers"
import { forgetUsername } from "./recent-usernames"
import { watchToolbar } from "./toolbar"

const AUTO_LOCK_ALARM = "autoLock"
/** Changes that come in a burst, such as an unlock and the sync after it, are announced once. */
const ANNOUNCE_DELAY_MS = 300

/**
 * Chrome runs content scripts only in pages loaded after the extension was installed or updated;
 * pages already open get them here, so their fields show the icon without a reload.
 */
async function injectIntoOpenTabs(): Promise<void> {
  const tabs = await browser.tabs.query({ url: ["http://*/*", "https://*/*"] })
  await Promise.all(
    tabs.map((tab) =>
      tab.id === undefined
        ? undefined
        : browser.scripting
            .executeScript({
              target: { tabId: tab.id, allFrames: true },
              files: ["/content-scripts/content.js"],
            })
            .catch(() => {}),
    ),
  )
}

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

  serveRequests(createHandlers(providers, { apple, bitwarden }), errorCode)
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
    if (port.name !== APPLE_PAIRING_PORT) return
    const kind = port.sender ? senderKind(port.sender) : null
    if (kind !== "popup" && kind !== "options") {
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
    // Tabs opened before an install or update have no working content script; after a browser
    // update they still have theirs.
    if (reason === "install" || reason === "update") void injectIntoOpenTabs()
  })

  browser.tabs.onRemoved.addListener((tabId) => {
    void forgetUsername(tabId)
    void promptSessions.remove(tabId)
    void menuSessions.remove(tabId)
  })
}

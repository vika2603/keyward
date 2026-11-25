import { controlBrowserSaving } from "@/lib/browser-saving"
import { senderKind, serveRequests } from "@/lib/messaging"
import { AppleProvider } from "@/lib/providers/apple/apple-provider"
import { ApiError } from "@/lib/providers/bitwarden/api"
import { BitwardenProvider } from "@/lib/providers/bitwarden/bitwarden-provider"
import { WrongPasswordError } from "@/lib/providers/bitwarden/crypto"
import { loadVaultCrypto } from "@/lib/providers/bitwarden/sdk-loader"
import { VaultError } from "@/lib/providers/types"
import { getSettings, settingsItem } from "@/lib/settings"
import { APPLE_PAIRING_PORT, VAULTS_CHANGED_KEY } from "./api"
import { fillFirst } from "./autofill"
import { CLEAR_CLIPBOARD_ALARM, clearClipboard } from "./clipboard"
import { watchCodeSetup } from "./code-setup"
import { createHandlers, openPopup } from "./handlers"
import { menus } from "./overlays"
import { Providers } from "./providers"
import { forgetTab } from "./save-flow"
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

function errorCode(error: unknown): string {
  if (error instanceof VaultError) return error.code
  if (error instanceof WrongPasswordError) return "bitwarden.wrongPassword"
  if (error instanceof ApiError)
    return error.isAuthError ? "bitwarden.auth" : "bitwarden.api"
  if (error instanceof TypeError) return "network"
  return "internal"
}

/** Wires the providers to messages, alarms and commands. Listeners are registered synchronously. */
export function startBackground(): void {
  const apple = new AppleProvider()
  const bitwarden = new BitwardenProvider(loadVaultCrypto)
  const providers = new Providers(apple, bitwarden)

  serveRequests(createHandlers(providers), errorCode)
  const refreshToolbar = watchToolbar(providers)
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
  apple.onChange((state) => {
    if ((state.phase === "paired") === appleReady) return
    appleReady = state.phase === "paired"
    announce()
  })
  bitwarden.onChange(announce)
  // A Passwords code added or removed changes which code fields get the icon.
  apple.onCodesChanged(announce)

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
      if (!viewsOpen()) void apple.cancelPairing(viewsOpen).catch(() => {})
    })
  })

  void getSettings().then((settings) => {
    void apple.setEnabled(settings.appleEnabled)
    void controlBrowserSaving(settings.takeOverSaving).catch(() => {})
  })
  settingsItem.watch((next, previous) => {
    if (next?.appleEnabled !== previous?.appleEnabled)
      void apple.setEnabled(Boolean(next?.appleEnabled))
    if (next?.takeOverSaving !== previous?.takeOverSaving)
      void controlBrowserSaving(next?.takeOverSaving ?? true).catch(() => {})
    // Turning a provider on or off and site rules change what the badge counts.
    refreshToolbar()
  })

  browser.idle.onStateChanged.addListener(async (state) => {
    if (state === "locked" && (await getSettings()).lockOnSystemLock)
      await bitwarden.lockAll()
  })

  void browser.alarms.create(AUTO_LOCK_ALARM, { periodInMinutes: 1 })
  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === AUTO_LOCK_ALARM) {
      const { autoLockMinutes } = await getSettings()
      if (autoLockMinutes !== null) await bitwarden.lockIdle(autoLockMinutes)
    } else if (alarm.name === CLEAR_CLIPBOARD_ALARM) {
      await clearClipboard()
    }
  })

  browser.commands.onCommand.addListener((command) => {
    if (command === "fill-first")
      // With nothing to fill, the popup shows why: vaults to unlock or pair, or no login for the site.
      void fillFirst(providers)
        .then((result) =>
          result === "noLogin" ? openPopup({ name: "main" }) : undefined,
        )
        .catch(() => {})
    else if (command === "open-generator") void openPopup({ name: "generator" })
    else if (command === "lock-all") void providers.lockAll()
  })

  browser.runtime.onInstalled.addListener(({ reason }) => {
    // Tabs opened before an install or update have no working content script; after a browser
    // update they still have theirs.
    if (reason === "install" || reason === "update") void injectIntoOpenTabs()
  })

  browser.tabs.onRemoved.addListener((tabId) => {
    void forgetTab(tabId)
    void menus.remove(tabId)
  })
}

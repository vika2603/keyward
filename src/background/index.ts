import { AppleBackend } from "@/lib/backends/apple/apple-backend"
import { ApiError } from "@/lib/backends/bitwarden/api"
import { BitwardenBackend } from "@/lib/backends/bitwarden/bitwarden-backend"
import { WrongPasswordError } from "@/lib/backends/bitwarden/crypto"
import { loadVaultCrypto } from "@/lib/backends/bitwarden/sdk-loader"
import { BackendError } from "@/lib/backends/types"
import { serveRequests } from "@/lib/messaging"
import { getSettings, settingsItem } from "@/lib/settings"
import { fillFirst } from "./autofill"
import { Backends } from "./backends"
import { CLEAR_CLIPBOARD_ALARM, clearClipboard } from "./clipboard"
import { createHandlers, openPopup } from "./handlers"
import { menus } from "./overlays"
import { forgetTab } from "./save-flow"

const AUTO_LOCK_ALARM = "autoLock"

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
  if (error instanceof BackendError) return error.code
  if (error instanceof WrongPasswordError) return "bitwarden.wrongPassword"
  if (error instanceof ApiError)
    return error.isAuthError ? "bitwarden.auth" : "bitwarden.api"
  if (error instanceof TypeError) return "network"
  return "internal"
}

/** Wires the backends to messages, alarms and commands. Listeners are registered synchronously. */
export function startBackground(): void {
  const apple = new AppleBackend()
  const bitwarden = new BitwardenBackend(loadVaultCrypto)
  const backends = new Backends(apple, bitwarden)

  serveRequests(createHandlers(backends), errorCode)

  void getSettings().then((settings) => apple.setEnabled(settings.appleEnabled))
  settingsItem.watch((next, previous) => {
    if (next?.appleEnabled !== previous?.appleEnabled)
      void apple.setEnabled(Boolean(next?.appleEnabled))
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
      // With nothing to fill, the popup shows why: sources to unlock or pair, or no login for the site.
      void fillFirst(backends)
        .then((result) =>
          result === "noLogin" ? openPopup({ name: "main" }) : undefined,
        )
        .catch(() => {})
    else if (command === "open-generator") void openPopup({ name: "generator" })
    else if (command === "lock-all") void backends.lockAll()
  })

  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === "install")
      void browser.tabs.create({
        url: browser.runtime.getURL("/options.html#onboard"),
      })
    // Tabs opened before an install or update have no working content script; on a browser
    // update they still have one, and a second copy would answer messages too.
    if (reason === "install" || reason === "update") void injectIntoOpenTabs()
  })

  browser.tabs.onRemoved.addListener((tabId) => {
    void forgetTab(tabId)
    void menus.remove(tabId)
  })
}

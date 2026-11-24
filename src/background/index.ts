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
    if (command === "fill-first") void fillFirst(backends).catch(() => {})
    else if (command === "open-generator") void openPopup({ name: "generator" })
    else if (command === "lock-all") void backends.lockAll()
  })

  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === "install")
      void browser.tabs.create({
        url: browser.runtime.getURL("/options.html#onboard"),
      })
  })

  browser.tabs.onRemoved.addListener((tabId) => {
    void forgetTab(tabId)
    void menus.remove(tabId)
  })
}

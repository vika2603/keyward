import { storage } from "wxt/utils/storage"
import type { HelperCheck } from "@/lib/providers/apple/helper-port"
import { updateSettings } from "@/lib/settings"

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

/**
 * Opens the welcome page, which connects a new install's first vaults. Passwords is turned on
 * first when the browser already reaches its helper, as after a reinstall, so the page opens with
 * it connected rather than offering to connect it.
 */
async function welcome(
  checkPasswords: () => Promise<HelperCheck>,
): Promise<void> {
  const check = await checkPasswords().catch(() => null)
  if (check?.reached)
    await updateSettings({ appleEnabled: true }).catch(() => {})
  await browser.tabs.create({ url: browser.runtime.getURL("/welcome.html") })
}

/**
 * What an install or an update of the extension starts, as `runtime.onInstalled` reports it.
 * `checkPasswords` asks whether the browser reaches the Passwords helper.
 */
export async function whenInstalled(
  reason: string,
  checkPasswords: () => Promise<HelperCheck>,
): Promise<void> {
  const work: Promise<unknown>[] = []
  // Tabs opened before an install or update have no working content script; after a browser
  // update they still have theirs.
  if (reason === "install" || reason === "update")
    work.push(injectIntoOpenTabs())
  if (reason === "install") work.push(welcome(checkPasswords))
  // Earlier versions kept the sites of passkey sign-ins under this key; nothing reads it now.
  if (reason === "update") work.push(storage.removeItem("local:passkeySites"))
  await Promise.allSettled(work)
}

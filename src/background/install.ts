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

/** What an install or an update of the extension starts, as `runtime.onInstalled` reports it. */
export async function whenInstalled(reason: string): Promise<void> {
  const work: Promise<unknown>[] = []
  // Tabs opened before an install or update have no working content script; after a browser
  // update they still have theirs.
  if (reason === "install" || reason === "update")
    work.push(injectIntoOpenTabs())
  // A new install has no vault yet; the welcome page connects the first ones.
  if (reason === "install")
    work.push(
      browser.tabs.create({ url: browser.runtime.getURL("/welcome.html") }),
    )
  await Promise.allSettled(work)
}

import { beforeEach, describe, expect, it } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { whenInstalled } from "./install"

/** The pages open in tabs, apart from the blank tab the fake browser starts with. */
async function openPages(): Promise<string[]> {
  return (await fakeBrowser.tabs.query({})).flatMap((tab) =>
    tab.url ? [tab.url] : [],
  )
}

describe("installing and updating", () => {
  beforeEach(() => {
    fakeBrowser.reset()
  })

  it("opens the welcome page on a new install", async () => {
    await whenInstalled("install")
    expect(await openPages()).toEqual([browser.runtime.getURL("/welcome.html")])
  })

  it("opens no page on an update of the extension or the browser", async () => {
    await whenInstalled("update")
    await whenInstalled("chrome_update")
    expect(await openPages()).toEqual([])
  })
})

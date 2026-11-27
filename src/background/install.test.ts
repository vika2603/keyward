import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { getSettings, updateSettings } from "@/lib/settings"
import { whenInstalled } from "./install"

const notSetUp = async () => ({
  reached: false as const,
  problem: "notSetUp" as const,
  error: "Specified native messaging host not found.",
})

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
    await whenInstalled("install", notSetUp)
    expect(await openPages()).toEqual([browser.runtime.getURL("/welcome.html")])
    expect((await getSettings()).appleEnabled).toBe(false)
  })

  it("turns Passwords on for a new install that already reaches its helper", async () => {
    await whenInstalled("install", async () => ({ reached: true }))
    expect((await getSettings()).appleEnabled).toBe(true)
    expect(await openPages()).toEqual([browser.runtime.getURL("/welcome.html")])
  })

  it("opens no page and leaves Passwords as it was on an update of the extension or the browser", async () => {
    const checkPasswords = vi.fn(async () => ({ reached: true as const }))
    await updateSettings({ appleEnabled: false })
    await whenInstalled("update", checkPasswords)
    await whenInstalled("chrome_update", checkPasswords)
    expect(await openPages()).toEqual([])
    expect(checkPasswords).not.toHaveBeenCalled()
    expect((await getSettings()).appleEnabled).toBe(false)
  })

  it("drops the passkey sites that earlier versions kept, on an update", async () => {
    await fakeBrowser.storage.local.set({ passkeySites: ["example.com"] })
    await whenInstalled("update", notSetUp)
    expect(await fakeBrowser.storage.local.get("passkeySites")).toEqual({})
  })

  it("drops a forwarding API key earlier versions kept unencrypted, on an update", async () => {
    await fakeBrowser.storage.local.set({
      generatorChoices: {
        kind: "username",
        username: {
          type: "forwarded",
          forwardingService: "addyio",
          forwardingApiKey: "plain-key",
          forwardingDomain: "example.com",
          forwardingBaseUrl: "",
        },
      },
    })
    await whenInstalled("update", notSetUp)
    expect(await fakeBrowser.storage.local.get("generatorChoices")).toEqual({
      generatorChoices: {
        kind: "username",
        username: { type: "forwarded", forwardingService: "addyio" },
      },
    })
  })
})

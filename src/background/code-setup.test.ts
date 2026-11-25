import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { offerCandidate, pendingSetup, watchCodeSetup } from "./code-setup"
import { frames, setFrame } from "./test-support"

vi.mock("./page", async () => (await import("./test-support")).pageModule)

const TAB = 5
const KEY =
  "otpauth://totp/Example:someone?secret=ABCDEFGHIJKLMNOP&issuer=Example"

type Clicked = (
  info: { menuItemId: string; frameId?: number },
  tab?: { id?: number; url?: string },
) => Promise<void>

let clicked: Clicked
const openPopup = vi.fn()

beforeEach(() => {
  fakeBrowser.reset()
  frames.clear()
  vi.clearAllMocks()
  // The fake browser leaves context menus out; the code needs these four.
  const menus = fakeBrowser.contextMenus as unknown as Record<string, unknown>
  menus.create = vi.fn()
  menus.update = vi.fn(async () => {})
  menus.removeAll = vi.fn(async () => {})
  menus.onClicked = {
    addListener: (listener: Clicked) => {
      clicked = listener
    },
  }
  setFrame(TAB, 0, "https://bank.example.com/settings")
  setFrame(TAB, 3, "https://widget.example.net/setup")
  watchCodeSetup(openPopup)
})

describe("watchCodeSetup", () => {
  it("sets a key up for the site of the frame it was picked in, not the top page's", async () => {
    expect(await offerCandidate(TAB, 3, { uri: KEY })).toBe(true)
    await clicked(
      { menuItemId: "setUpCode", frameId: 3 },
      { id: TAB, url: "https://bank.example.com/settings" },
    )
    const pending = await pendingSetup()
    expect(pending.page.hostname).toBe("widget.example.net")
    expect(pending.uri).toBe(KEY)
    expect(openPopup).toHaveBeenCalledWith({ name: "codeSetup" })
  })

  it("ignores a click in another frame than the one that offered the key", async () => {
    await offerCandidate(TAB, 3, { uri: KEY })
    await clicked(
      { menuItemId: "setUpCode", frameId: 0 },
      { id: TAB, url: "https://bank.example.com/settings" },
    )
    await expect(pendingSetup()).rejects.toMatchObject({ code: "noSetup" })
    expect(openPopup).not.toHaveBeenCalled()
  })

  it("offers nothing for a link that is not an authenticator key", async () => {
    expect(
      await offerCandidate(TAB, 0, { uri: "otpauth://hotp/Example?secret=x" }),
    ).toBe(false)
    await clicked({ menuItemId: "setUpCode", frameId: 0 }, { id: TAB })
    await expect(pendingSetup()).rejects.toMatchObject({ code: "noSetup" })
  })
})

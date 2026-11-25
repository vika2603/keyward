import { beforeEach, describe, expect, it, vi } from "vitest"
import { offerCandidate, pendingSetup, watchCodeSetup } from "./code-setup"
import { fakeContextMenus, resetBackground, setFrame } from "./test-support"

vi.mock("./page", async () => (await import("./test-support")).pageModule)

const TAB = 5
const KEY =
  "otpauth://totp/Example:someone?secret=ABCDEFGHIJKLMNOP&issuer=Example"

let contextMenus: ReturnType<typeof fakeContextMenus>
const openPopup = vi.fn()

beforeEach(() => {
  resetBackground()
  contextMenus = fakeContextMenus()
  setFrame(TAB, 0, "https://bank.example.com/settings")
  setFrame(TAB, 3, "https://widget.example.net/setup")
  watchCodeSetup(openPopup)
})

describe("watchCodeSetup", () => {
  it("sets a key up for the site of the frame it was picked in, not the top page's", async () => {
    expect(await offerCandidate(TAB, 3, { uri: KEY })).toBe(true)
    await contextMenus.click(
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
    await contextMenus.click(
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
    await contextMenus.click(
      { menuItemId: "setUpCode", frameId: 0 },
      { id: TAB },
    )
    await expect(pendingSetup()).rejects.toMatchObject({ code: "noSetup" })
  })
})

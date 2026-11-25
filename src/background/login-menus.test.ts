import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { updateSettings } from "@/lib/settings"
import type { VaultView } from "./api"
import { fillLogin } from "./autofill"
import { copyText } from "./clipboard"
import { LoginMenus } from "./login-menus"
import { accountVault, fakeProviders } from "./test-support"

vi.mock("./autofill", () => ({ fillLogin: vi.fn() }))
vi.mock("./clipboard", () => ({ copyText: vi.fn() }))

type Clicked = (
  info: { menuItemId: string; frameId?: number },
  tab?: { id?: number; url?: string },
) => void

const TAB = 4
const PAGE_URL = "https://example.com/login"
const tab = { id: TAB, url: PAGE_URL }
const credential = { username: "someone", password: "{{SECRET_kctwy60h}}" }
const someone = {
  id: "item-1",
  username: "someone",
  title: "Example",
  hasCode: true,
}
const shared = { id: "item-2", username: "", title: "Shared account" }

let created: { id: string; parentId?: string; title: string }[]
let clicked: Clicked

beforeEach(() => {
  fakeBrowser.reset()
  vi.clearAllMocks()
  created = []
  // The fake browser leaves context menus out; the code needs these.
  const menus = fakeBrowser.contextMenus as unknown as Record<string, unknown>
  menus.create = vi.fn(
    (properties: (typeof created)[number], done?: () => void) => {
      created.push(properties)
      done?.()
    },
  )
  menus.remove = vi.fn(async () => {})
  menus.onClicked = {
    addListener: (listener: Clicked) => {
      clicked = listener
    },
  }
})

function id(action: string, title: string): string {
  return (
    created.find(
      (item) =>
        item.parentId === `loginMenus.${action}` && item.title === title,
    )?.id ?? ""
  )
}

function setUp() {
  const { providers, calls } = fakeProviders([
    { info: accountVault, credential, logins: [someone, shared] },
  ])
  const vaults: VaultView[] = [{ ...accountVault, logins: [someone, shared] }]
  return { menus: new LoginMenus(providers), calls, vaults }
}

describe("LoginMenus", () => {
  it("lists the page's logins under each action, leaving out what a login lacks", async () => {
    const { menus, vaults } = setUp()
    await menus.show(vaults, tab)
    const under = (parent: string) =>
      created
        .filter((item) => item.parentId === parent)
        .map((item) => item.title)
    expect(under("loginMenus.fill")).toEqual(["someone", "Shared account"])
    expect(under("loginMenus.copyUsername")).toEqual(["someone"])
    expect(under("loginMenus.copyCode")).toEqual(["someone"])
    expect(created.map((item) => item.id)).toContain("loginMenus.generate")
  })

  it("fills into the frame that was right-clicked, and copies a password as a secret", async () => {
    const { menus, vaults, calls } = setUp()
    await menus.show(vaults, tab)
    clicked({ menuItemId: id("fill", "Shared account"), frameId: 2 }, tab)
    clicked({ menuItemId: id("copyPassword", "someone"), frameId: 0 }, tab)
    // The listener starts the work without waiting for it.
    await vi.waitFor(() => {
      expect(fillLogin).toHaveBeenCalledWith(
        expect.anything(),
        TAB,
        2,
        accountVault.id,
        "item-2",
      )
      expect(copyText).toHaveBeenCalledWith(credential.password, true)
    })
    // The password is read for the clicked page, so the provider checks the login belongs to it.
    expect(calls.credential.mock.calls[0]?.[2]).toEqual(new URL(PAGE_URL))
  })

  it("ignores clicks on another tab or page, and on menus from an earlier listing", async () => {
    const { menus, vaults } = setUp()
    await menus.show(vaults, tab)
    const earlier = id("copyPassword", "someone")
    clicked({ menuItemId: earlier, frameId: 0 }, { id: TAB + 1, url: PAGE_URL })
    clicked(
      { menuItemId: earlier, frameId: 0 },
      { id: TAB, url: "https://other.example/" },
    )
    created = []
    await menus.show(vaults, tab)
    clicked({ menuItemId: earlier, frameId: 0 }, tab)
    clicked({ menuItemId: id("copyUsername", "someone"), frameId: 0 }, tab)
    await vi.waitFor(() =>
      expect(copyText).toHaveBeenCalledWith("someone", false),
    )
    expect(copyText).toHaveBeenCalledTimes(1)
  })

  it("finds the clicked login after the service worker started again", async () => {
    const { menus, vaults } = setUp()
    await menus.show(vaults, tab)
    // A new worker has the stored entries but none of the earlier one's memory.
    const { providers } = fakeProviders([{ info: accountVault, credential }])
    new LoginMenus(providers)
    clicked({ menuItemId: id("copyUsername", "someone"), frameId: 0 }, tab)
    await vi.waitFor(() =>
      expect(copyText).toHaveBeenCalledWith("someone", false),
    )
  })

  it("shows only the generator without logins, and nothing when turned off", async () => {
    const { menus } = setUp()
    await menus.show([], tab)
    expect(created.map((item) => item.id)).toEqual(["loginMenus.generate"])
    created = []
    await updateSettings({ contextMenu: false })
    await menus.show([], tab)
    expect(created).toEqual([])
  })
})

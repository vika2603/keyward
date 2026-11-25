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
  tab?: { id?: number },
) => void

const TAB = 4
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
    await menus.show(vaults)
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
    const { menus, vaults } = setUp()
    await menus.show(vaults)
    const id = (action: string, title: string) =>
      created.find(
        (item) =>
          item.parentId === `loginMenus.${action}` && item.title === title,
      )?.id ?? ""
    clicked(
      { menuItemId: id("fill", "Shared account"), frameId: 2 },
      { id: TAB },
    )
    clicked(
      { menuItemId: id("copyPassword", "someone"), frameId: 0 },
      { id: TAB },
    )
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
  })

  it("finds the clicked login after the service worker started again", async () => {
    const { menus, vaults } = setUp()
    await menus.show(vaults)
    const id =
      created.find(
        (item) =>
          item.parentId === "loginMenus.copyUsername" &&
          item.title === "someone",
      )?.id ?? ""
    // A new worker has the stored entries but none of the earlier one's memory.
    const { providers } = fakeProviders([{ info: accountVault, credential }])
    new LoginMenus(providers)
    clicked({ menuItemId: id, frameId: 0 }, { id: TAB })
    await vi.waitFor(() =>
      expect(copyText).toHaveBeenCalledWith("someone", false),
    )
  })

  it("shows only the generator without logins, and nothing when turned off", async () => {
    const { menus } = setUp()
    await menus.show([])
    expect(created.map((item) => item.id)).toEqual(["loginMenus.generate"])
    created = []
    await updateSettings({ contextMenu: false })
    await menus.show([])
    expect(created).toEqual([])
  })
})

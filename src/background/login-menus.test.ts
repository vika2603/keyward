import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { updateSettings } from "@/lib/settings"
import type { VaultView } from "./api"
import { fillLogin, fillNewPassword } from "./autofill"
import { copyText } from "./clipboard"
import { LoginMenus } from "./login-menus"
import { accountVault, fakeContextMenus, fakeProviders } from "./test-support"

vi.mock("./autofill", () => ({ fillLogin: vi.fn(), fillNewPassword: vi.fn() }))
vi.mock("./clipboard", () => ({ copyText: vi.fn() }))

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

let contextMenus: ReturnType<typeof fakeContextMenus>

beforeEach(() => {
  fakeBrowser.reset()
  vi.clearAllMocks()
  contextMenus = fakeContextMenus()
})

/** The login's menu, found by the line it shows. */
function loginMenu(title: string) {
  return contextMenus.created.find(
    (item) => item.parentId === undefined && item.title === title,
  )
}

/** The ID of an action in a login's submenu. */
function id(action: string, title: string): string {
  const login = loginMenu(title)
  return (
    contextMenus.created.find(
      (item) =>
        item.parentId === login?.id &&
        item.id.startsWith(`loginMenus.${action}.`),
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
  it("lists each login once under its vault's heading, with only the actions it has", async () => {
    const { menus, vaults } = setUp()
    await menus.show(vaults, tab)
    const topLevel = contextMenus.created
      .filter((item) => item.parentId === undefined)
      .map((item) => (item.type === "separator" ? "---" : item.title))
    expect(topLevel).toEqual([
      "Bitwarden · someone@example.com",
      "someone",
      "Shared account",
      "---",
      expect.any(String),
      expect.any(String),
    ])
    expect(contextMenus.created[0]?.enabled).toBe(false)
    const actions = (title: string) =>
      contextMenus.created
        .filter((item) => item.parentId === loginMenu(title)?.id)
        .map((item) => item.id.split(".")[1])
    expect(actions("someone")).toEqual([
      "fill",
      "copyUsername",
      "copyPassword",
      "copyCode",
    ])
    expect(actions("Shared account")).toEqual(["fill", "copyPassword"])
    expect(contextMenus.created.at(-1)?.id).toBe("loginMenus.generate")
  })

  it("puts each vault's logins under its own heading, and removes the earlier menus first", async () => {
    const apple: VaultView = {
      id: "apple",
      kind: "apple",
      label: "Apple Passwords",
      status: "ready",
      logins: [{ id: "a-1", username: "someone", title: "Example" }],
    }
    const { menus, vaults } = setUp()
    await menus.show(vaults, tab)
    const earlier = contextMenus.created
      .filter((item) => item.parentId === undefined)
      .map((item) => item.id)
    contextMenus.created.length = 0
    await menus.show([apple, ...vaults], tab)
    expect(
      contextMenus.created
        .filter((item) => item.parentId === undefined)
        .map((item) => (item.type === "separator" ? "---" : item.title))
        .slice(0, 5),
    ).toEqual([
      "Passwords",
      "someone",
      "---",
      "Bitwarden · someone@example.com",
      "someone",
    ])
    const removed = vi
      .mocked(fakeBrowser.contextMenus.remove)
      .mock.calls.map(([menuId]) => menuId)
    expect(removed).toEqual(expect.arrayContaining(earlier))
  })

  it("removes the menus of the browser session before, whose storage.session is gone", async () => {
    const { menus, vaults } = setUp()
    await menus.show(vaults, tab)
    const earlier = contextMenus.created
      .filter((item) => item.parentId === undefined)
      .map((item) => item.id)
    await fakeBrowser.storage.session.clear()
    vi.mocked(fakeBrowser.contextMenus.remove).mockClear()
    await setUp().menus.show(vaults, tab)
    const removed = vi
      .mocked(fakeBrowser.contextMenus.remove)
      .mock.calls.map(([menuId]) => menuId)
    expect(removed).toEqual(expect.arrayContaining(earlier))
  })

  it("fills into the frame that was right-clicked, and copies a password as a secret", async () => {
    const { menus, vaults, calls } = setUp()
    await menus.show(vaults, tab)
    contextMenus.click(
      { menuItemId: id("fill", "Shared account"), frameId: 2 },
      tab,
    )
    contextMenus.click(
      { menuItemId: id("copyPassword", "someone"), frameId: 0 },
      tab,
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
    // The password is read for the clicked page, so the provider checks the login belongs to it.
    expect(calls.credential.mock.calls[0]?.[2]).toEqual(new URL(PAGE_URL))
  })

  it("leaves the clipboard as it is for a login without a password", async () => {
    const { providers, calls } = fakeProviders([
      {
        info: accountVault,
        credential: { username: "someone", password: "" },
        logins: [someone],
      },
    ])
    const menus = new LoginMenus(providers)
    await menus.show([{ ...accountVault, logins: [someone] }], tab)
    contextMenus.click(
      { menuItemId: id("copyPassword", "someone"), frameId: 0 },
      tab,
    )
    await vi.waitFor(() => expect(calls.credential).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(copyText).not.toHaveBeenCalled()
  })

  it("fills a generated password into the right-clicked field's frame, offered only on fields", async () => {
    const { menus } = setUp()
    await menus.show([], tab)
    const generateFill = contextMenus.created.find(
      (item) => item.id === "loginMenus.generateFill",
    )
    expect(generateFill?.contexts).toEqual(["editable"])
    vi.mocked(fillNewPassword).mockResolvedValueOnce(true)
    contextMenus.click(
      { menuItemId: "loginMenus.generateFill", frameId: 2 },
      tab,
    )
    await vi.waitFor(() =>
      expect(fillNewPassword).toHaveBeenCalledWith(TAB, 2, expect.any(String)),
    )
    const password = vi.mocked(fillNewPassword).mock.calls[0]?.[2] ?? ""
    expect(password.length).toBeGreaterThanOrEqual(8)
    expect(copyText).not.toHaveBeenCalled()
  })

  it("copies the generated password when the page has no field for it, or filling fails", async () => {
    const { menus } = setUp()
    await menus.show([], tab)
    vi.mocked(fillNewPassword).mockResolvedValueOnce(false)
    contextMenus.click(
      { menuItemId: "loginMenus.generateFill", frameId: 0 },
      tab,
    )
    await vi.waitFor(() => expect(copyText).toHaveBeenCalledTimes(1))
    const unfilled = vi.mocked(fillNewPassword).mock.calls[0]?.[2]
    expect(copyText).toHaveBeenLastCalledWith(unfilled, true)
    vi.mocked(fillNewPassword).mockRejectedValueOnce(new Error("turned off"))
    contextMenus.click(
      { menuItemId: "loginMenus.generateFill", frameId: 0 },
      tab,
    )
    await vi.waitFor(() => expect(copyText).toHaveBeenCalledTimes(2))
    expect(copyText).toHaveBeenLastCalledWith(
      vi.mocked(fillNewPassword).mock.calls[1]?.[2],
      true,
    )
  })

  it("ignores clicks on another tab or page, and on menus from an earlier listing", async () => {
    const { menus, vaults } = setUp()
    await menus.show(vaults, tab)
    const earlier = id("copyPassword", "someone")
    contextMenus.click(
      { menuItemId: earlier, frameId: 0 },
      { id: TAB + 1, url: PAGE_URL },
    )
    contextMenus.click(
      { menuItemId: earlier, frameId: 0 },
      { id: TAB, url: "https://other.example/" },
    )
    contextMenus.created.length = 0
    await menus.show(vaults, tab)
    contextMenus.click({ menuItemId: earlier, frameId: 0 }, tab)
    contextMenus.click(
      { menuItemId: id("copyUsername", "someone"), frameId: 0 },
      tab,
    )
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
    contextMenus.click(
      { menuItemId: id("copyUsername", "someone"), frameId: 0 },
      tab,
    )
    await vi.waitFor(() =>
      expect(copyText).toHaveBeenCalledWith("someone", false),
    )
  })

  it("shows only the generator without logins, and nothing when turned off", async () => {
    const { menus } = setUp()
    await menus.show([], tab)
    expect(contextMenus.created.map((item) => item.id)).toEqual([
      "loginMenus.generateFill",
      "loginMenus.generate",
    ])
    contextMenus.created.length = 0
    await updateSettings({ contextMenu: false })
    await menus.show([], tab)
    expect(contextMenus.created).toEqual([])
  })
})

import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { updateSettings } from "@/lib/settings"
import {
  contentConfig,
  fillCode,
  fillFirst,
  fillLogin,
  fillNewPassword,
  hasCodes,
  notePasskeyUsed,
} from "./autofill"
import { listHistory } from "./history"
import { markRecent, recallUsername, rememberUsername } from "./save-flow"
import {
  accountVault,
  appleVault,
  fakeProviders,
  frames,
  pageModule,
  setFrame,
} from "./test-support"

vi.mock("./page", async () => (await import("./test-support")).pageModule)

const TAB = 9
const credential = { username: "someone", password: "stored-password" }

beforeEach(() => {
  fakeBrowser.reset()
  frames.clear()
  vi.clearAllMocks()
  setFrame(TAB, 0, "https://accounts.example.com/login")
})

describe("fillLogin", () => {
  it("remembers who signed in, so a code step that follows offers that login first", async () => {
    const { providers } = fakeProviders([{ info: accountVault, credential }])
    await fillLogin(providers, TAB, 0, accountVault.id, "item-1")
    expect(await recallUsername(TAB, "example.com")).toBe("someone")
  })

  it("sends the login to the frame together with the origin it was checked for", async () => {
    const { providers, calls } = fakeProviders([
      { info: accountVault, credential },
    ])
    await fillLogin(providers, TAB, 0, accountVault.id, "item-1")
    expect(calls.credential).toHaveBeenCalledWith(
      accountVault.id,
      "item-1",
      new URL("https://accounts.example.com/login"),
      { tabId: TAB, frameId: 0 },
    )
    expect(pageModule.sendToFrame).toHaveBeenCalledWith(TAB, 0, {
      type: "fill",
      origin: "https://accounts.example.com",
      ...credential,
      fields: [],
      autoSubmit: false,
    })
  })

  it("sends nothing when the frame navigated while the password was read", async () => {
    const { providers } = fakeProviders([{ info: accountVault, credential }])
    pageModule.frameUrl.mockImplementationOnce(
      async () => new URL("https://accounts.example.com/login"),
    )
    pageModule.frameUrl.mockImplementationOnce(
      async () => new URL("https://attacker.net/"),
    )
    await expect(
      fillLogin(providers, TAB, 0, accountVault.id, "item-1"),
    ).rejects.toMatchObject({
      code: "pageChanged",
    })
    expect(pageModule.sendToFrame).not.toHaveBeenCalled()
  })

  it("refuses a vault that does not serve the site", async () => {
    const { providers } = fakeProviders([{ info: accountVault, credential }])
    await expect(
      fillLogin(providers, TAB, 0, appleVault.id, "x"),
    ).rejects.toMatchObject({
      code: "unknownVault",
    })
    expect(pageModule.sendToFrame).not.toHaveBeenCalled()
  })

  it("does not fill a cross-origin frame unless the setting allows it", async () => {
    setFrame(TAB, 4, "https://widget.other.net/login")
    const { providers } = fakeProviders([{ info: accountVault, credential }])
    await expect(
      fillLogin(providers, TAB, 4, accountVault.id, "item-1"),
    ).rejects.toMatchObject({
      code: "fillDisabled",
    })
    await updateSettings({ crossOriginFrames: true })
    await fillLogin(providers, TAB, 4, accountVault.id, "item-1")
    expect(pageModule.sendToFrame).toHaveBeenCalledWith(
      TAB,
      4,
      expect.objectContaining({
        origin: "https://widget.other.net",
      }),
    )
  })

  it("does not fill on a site whose rule disables it", async () => {
    await updateSettings({
      siteRules: [
        {
          id: "r",
          host: "example.com",
          match: null,
          provider: "all",
          behavior: "disabled",
        },
      ],
    })
    const { providers } = fakeProviders([{ info: accountVault, credential }])
    await expect(
      fillLogin(providers, TAB, 0, accountVault.id, "item-1"),
    ).rejects.toMatchObject({
      code: "fillDisabled",
    })
  })
})

describe("fillNewPassword", () => {
  const generated = "generated-test-value"

  it("sends the password with the frame's origin and keeps it in the generator's history", async () => {
    await fillNewPassword(TAB, 0, generated)
    expect(pageModule.sendToFrame).toHaveBeenCalledWith(TAB, 0, {
      type: "fillNew",
      origin: "https://accounts.example.com",
      password: generated,
    })
    expect(await listHistory()).toMatchObject([
      { value: generated, kind: "password", host: "accounts.example.com" },
    ])
  })

  it("sends nothing to a cross-origin frame unless the setting allows it", async () => {
    setFrame(TAB, 4, "https://widget.other.net/signup")
    await expect(fillNewPassword(TAB, 4, generated)).rejects.toMatchObject({
      code: "fillDisabled",
    })
    expect(pageModule.sendToFrame).not.toHaveBeenCalled()
    expect(await listHistory()).toEqual([])
  })
})

describe("fillFirst", () => {
  const login = { id: "item-1", username: "someone", title: "Example" }

  beforeEach(() => {
    pageModule.activeTab.mockResolvedValue({ id: TAB })
    const topFrame = {
      frameId: 0,
    } as Browser.webNavigation.GetAllFrameResultDetails
    vi.spyOn(fakeBrowser.webNavigation, "getAllFrames").mockImplementation(
      // The typings resolve to the callback overload, which returns nothing.
      (async () => [topFrame]) as never,
    )
    pageModule.sendToFrame.mockImplementation(async (_tab, _frame, message) =>
      (message as { type: string }).type === "fieldInfo"
        ? { hasField: true, focused: true }
        : undefined,
    )
  })

  it("fills the first login a ready vault lists for the page", async () => {
    const { providers } = fakeProviders([
      { info: accountVault, credential, logins: [login] },
    ])
    await expect(fillFirst(providers)).resolves.toBe("filled")
    expect(pageModule.sendToFrame).toHaveBeenCalledWith(
      TAB,
      0,
      expect.objectContaining({ type: "fill", username: "someone" }),
    )
  })

  it("fills the account typed on the first step of a two-step login", async () => {
    const other = { id: "item-2", username: "another", title: "Example" }
    const { providers, calls } = fakeProviders([
      { info: accountVault, credential, logins: [login, other] },
    ])
    await rememberUsername(TAB, "example.com", "another")
    await fillFirst(providers)
    expect(calls.credential).toHaveBeenCalledWith(
      accountVault.id,
      "item-2",
      expect.any(URL),
      expect.anything(),
    )
  })

  it("fills the next login on each further press, and starts over after a while", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    try {
      const second = { id: "item-2", username: "another", title: "Example" }
      const third = { id: "item-3", username: "third", title: "Example" }
      const { providers, calls } = fakeProviders([
        { info: accountVault, credential, logins: [login, second, third] },
      ])
      const filled: string[] = []
      calls.credential.mockImplementation(async (_vault, loginId) => {
        filled.push(loginId)
        return credential
      })
      for (let press = 0; press < 4; press++) {
        await fillFirst(providers)
        vi.advanceTimersByTime(2_000)
      }
      vi.advanceTimersByTime(60_000)
      await fillFirst(providers)
      expect(filled).toEqual(["item-1", "item-2", "item-3", "item-1", "item-1"])
    } finally {
      vi.useRealTimers()
    }
  })

  it("fills a different login for each of two presses at once", async () => {
    const second = { id: "item-2", username: "another", title: "Example" }
    const { providers, calls } = fakeProviders([
      { info: accountVault, credential, logins: [login, second] },
    ])
    await Promise.all([fillFirst(providers), fillFirst(providers)])
    expect(calls.credential.mock.calls.map((call) => call[1])).toEqual([
      "item-1",
      "item-2",
    ])
  })

  it("starts over on another page of the tab", async () => {
    const second = { id: "item-2", username: "another", title: "Example" }
    const { providers, calls } = fakeProviders([
      { info: accountVault, credential, logins: [login, second] },
    ])
    await fillFirst(providers)
    setFrame(TAB, 0, "https://accounts.example.com/other")
    await fillFirst(providers)
    expect(calls.credential.mock.calls.map((call) => call[1])).toEqual([
      "item-1",
      "item-1",
    ])
  })

  it("reports a login field with nothing to fill when the vaults are locked", async () => {
    const { providers } = fakeProviders([
      {
        info: { ...accountVault, status: "locked" },
        credential,
        logins: [login],
      },
    ])
    await expect(fillFirst(providers)).resolves.toBe("noLogin")
    expect(pageModule.sendToFrame).not.toHaveBeenCalledWith(
      TAB,
      0,
      expect.objectContaining({ type: "fill" }),
    )
  })

  it("does nothing on a page without a login field", async () => {
    pageModule.sendToFrame.mockResolvedValue({
      hasField: false,
      focused: false,
    })
    const { providers } = fakeProviders([
      { info: accountVault, credential, logins: [login] },
    ])
    await expect(fillFirst(providers)).resolves.toBe("noField")
  })
})

describe("fillCode", () => {
  const code = { code: "123456", period: 30, expiresAt: 60_000 }
  const codeLogin = { id: "item-1", username: "someone", title: "Example" }

  it("sends the current code to the frame with the origin it was checked for", async () => {
    const { providers, calls } = fakeProviders([{ info: accountVault, code }])
    await fillCode(providers, TAB, 0, accountVault.id, "item-1")
    expect(calls.oneTimeCode).toHaveBeenCalledWith(
      accountVault.id,
      "item-1",
      new URL("https://accounts.example.com/login"),
      { tabId: TAB, frameId: 0 },
    )
    expect(pageModule.sendToFrame).toHaveBeenCalledWith(TAB, 0, {
      type: "fillCode",
      origin: "https://accounts.example.com",
      code: "123456",
    })
  })

  it("sends nothing when the frame navigated while the code was read", async () => {
    const { providers } = fakeProviders([{ info: accountVault, code }])
    pageModule.frameUrl.mockImplementationOnce(
      async () => new URL("https://accounts.example.com/login"),
    )
    pageModule.frameUrl.mockImplementationOnce(
      async () => new URL("https://attacker.net/"),
    )
    await expect(
      fillCode(providers, TAB, 0, accountVault.id, "item-1"),
    ).rejects.toMatchObject({ code: "pageChanged" })
    expect(pageModule.sendToFrame).not.toHaveBeenCalled()
  })

  it("tells a frame whether a ready vault has codes for it", async () => {
    const withCodes = fakeProviders([
      { info: accountVault, codeLogins: [codeLogin] },
    ])
    expect(await hasCodes(withCodes.providers, TAB, 0)).toBe(true)
    const withoutCodes = fakeProviders([
      { info: accountVault, codeLogins: [] },
      { info: { ...appleVault, status: "locked" } },
    ])
    expect(await hasCodes(withoutCodes.providers, TAB, 0)).toBe(false)
  })

  it("gives code fields the icon while no vault is ready, to offer unlocking", async () => {
    const locked = fakeProviders([
      { info: { ...accountVault, status: "locked" } },
      { info: { ...appleVault, status: "locked" } },
    ])
    expect(await hasCodes(locked.providers, TAB, 0)).toBe(true)
    const none = fakeProviders([])
    expect(await hasCodes(none.providers, TAB, 0)).toBe(false)
  })
})

describe("passkey sites", () => {
  const takesOver = async (url: string, frameId = 0) => {
    setFrame(TAB, frameId, url)
    const { providers } = fakeProviders([{ info: accountVault }])
    return (await contentConfig(providers, TAB, frameId)).takeOverPasskeys
  }

  it("offers passkeys in the menu only on sites where one was used", async () => {
    expect(await takesOver("https://accounts.example.com/login")).toBe(false)
    await notePasskeyUsed(TAB, 0)
    expect(await takesOver("https://login.example.com/")).toBe(true)
    expect(await takesOver("https://example.org/login")).toBe(false)
    await updateSettings({ takeOverPasskeys: false })
    expect(await takesOver("https://accounts.example.com/login")).toBe(false)
  })

  it("does not learn from a frame that may not show the menu", async () => {
    setFrame(TAB, 3, "https://widget.example.net/")
    await notePasskeyUsed(TAB, 3)
    await updateSettings({ crossOriginFrames: true })
    expect(await takesOver("https://widget.example.net/", 3)).toBe(false)
  })
})

describe("markRecent", () => {
  const login = (id: string, username: string) => ({
    id,
    username,
    title: "example.com",
  })
  const apple = { ...appleVault, logins: [login("a1", "other")] }
  const account = {
    ...accountVault,
    logins: [login("b1", "first"), login("b2", "Someone@Example.com")],
  }

  it("puts the login signed in with first, in its vault and among the vaults", () => {
    const vaults = markRecent([apple, account], "someone@example.com")
    expect(vaults.map((vault) => vault.id)).toEqual([
      accountVault.id,
      appleVault.id,
    ])
    expect(vaults[0]?.logins.map((l) => [l.id, l.recent ?? false])).toEqual([
      ["b2", true],
      ["b1", false],
    ])
  })

  it("leaves the order alone without a recent sign-in", () => {
    expect(markRecent([apple, account], null)).toEqual([apple, account])
  })
})

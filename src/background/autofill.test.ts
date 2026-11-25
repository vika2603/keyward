import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { updateSettings } from "@/lib/settings"
import { fillCode, fillFirst, fillLogin, hasCodes } from "./autofill"
import {
  accountSource,
  appleSource,
  fakeBackends,
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
  it("sends the login to the frame together with the origin it was checked for", async () => {
    const { backends, calls } = fakeBackends([
      { info: accountSource, credential },
    ])
    await fillLogin(backends, TAB, 0, accountSource.id, "item-1")
    expect(calls.credential).toHaveBeenCalledWith(
      accountSource.id,
      "item-1",
      new URL("https://accounts.example.com/login"),
      { tabId: TAB, frameId: 0 },
    )
    expect(pageModule.sendToFrame).toHaveBeenCalledWith(TAB, 0, {
      type: "fill",
      origin: "https://accounts.example.com",
      ...credential,
      autoSubmit: false,
    })
  })

  it("sends nothing when the frame navigated while the password was read", async () => {
    const { backends } = fakeBackends([{ info: accountSource, credential }])
    pageModule.frameUrl.mockImplementationOnce(
      async () => new URL("https://accounts.example.com/login"),
    )
    pageModule.frameUrl.mockImplementationOnce(
      async () => new URL("https://attacker.net/"),
    )
    await expect(
      fillLogin(backends, TAB, 0, accountSource.id, "item-1"),
    ).rejects.toMatchObject({
      code: "pageChanged",
    })
    expect(pageModule.sendToFrame).not.toHaveBeenCalled()
  })

  it("refuses a source that does not serve the site", async () => {
    const { backends } = fakeBackends([{ info: accountSource, credential }])
    await expect(
      fillLogin(backends, TAB, 0, appleSource.id, "x"),
    ).rejects.toMatchObject({
      code: "unknownSource",
    })
    expect(pageModule.sendToFrame).not.toHaveBeenCalled()
  })

  it("does not fill a cross-origin frame unless the setting allows it", async () => {
    setFrame(TAB, 4, "https://widget.other.net/login")
    const { backends } = fakeBackends([{ info: accountSource, credential }])
    await expect(
      fillLogin(backends, TAB, 4, accountSource.id, "item-1"),
    ).rejects.toMatchObject({
      code: "fillDisabled",
    })
    await updateSettings({ crossOriginFrames: true })
    await fillLogin(backends, TAB, 4, accountSource.id, "item-1")
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
          backend: "all",
          behavior: "disabled",
        },
      ],
    })
    const { backends } = fakeBackends([{ info: accountSource, credential }])
    await expect(
      fillLogin(backends, TAB, 0, accountSource.id, "item-1"),
    ).rejects.toMatchObject({
      code: "fillDisabled",
    })
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

  it("fills the first login a ready source lists for the page", async () => {
    const { backends } = fakeBackends([
      { info: accountSource, credential, logins: [login] },
    ])
    await expect(fillFirst(backends)).resolves.toBe("filled")
    expect(pageModule.sendToFrame).toHaveBeenCalledWith(
      TAB,
      0,
      expect.objectContaining({ type: "fill", username: "someone" }),
    )
  })

  it("reports a login field with nothing to fill when the sources are locked", async () => {
    const { backends } = fakeBackends([
      {
        info: { ...accountSource, status: "locked" },
        credential,
        logins: [login],
      },
    ])
    await expect(fillFirst(backends)).resolves.toBe("noLogin")
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
    const { backends } = fakeBackends([
      { info: accountSource, credential, logins: [login] },
    ])
    await expect(fillFirst(backends)).resolves.toBe("noField")
  })
})

describe("fillCode", () => {
  const code = { code: "123456", period: 30, expiresAt: 60_000 }
  const codeLogin = { id: "item-1", username: "someone", title: "Example" }

  it("sends the current code to the frame with the origin it was checked for", async () => {
    const { backends, calls } = fakeBackends([{ info: accountSource, code }])
    await fillCode(backends, TAB, 0, accountSource.id, "item-1")
    expect(calls.oneTimeCode).toHaveBeenCalledWith(
      accountSource.id,
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
    const { backends } = fakeBackends([{ info: accountSource, code }])
    pageModule.frameUrl.mockImplementationOnce(
      async () => new URL("https://accounts.example.com/login"),
    )
    pageModule.frameUrl.mockImplementationOnce(
      async () => new URL("https://attacker.net/"),
    )
    await expect(
      fillCode(backends, TAB, 0, accountSource.id, "item-1"),
    ).rejects.toMatchObject({ code: "pageChanged" })
    expect(pageModule.sendToFrame).not.toHaveBeenCalled()
  })

  it("tells a frame whether a ready source has codes for it", async () => {
    const withCodes = fakeBackends([
      { info: accountSource, codeLogins: [codeLogin] },
    ])
    expect(await hasCodes(withCodes.backends, TAB, 0)).toBe(true)
    const locked = fakeBackends([
      {
        info: { ...accountSource, status: "locked" },
        codeLogins: [codeLogin],
      },
    ])
    expect(await hasCodes(locked.backends, TAB, 0)).toBe(false)
  })
})

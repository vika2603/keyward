import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { updateSettings } from "@/lib/settings"
import { prompts } from "./overlays"
import { onSubmitted, promptState, showPrompt } from "./save-flow"
import {
  accountSource,
  appleSource,
  fakeBackends,
  frames,
  pageModule,
  setFrame,
} from "./test-support"

vi.mock("./page", async () => (await import("./test-support")).pageModule)

const TAB = 7
const login = { username: "someone", password: "typed-password" }

beforeEach(() => {
  fakeBrowser.reset()
  frames.clear()
  vi.clearAllMocks()
  setFrame(TAB, 0, "https://accounts.example.com/login")
})

describe("onSubmitted", () => {
  it("offers to save a login that no source has", async () => {
    const { backends } = fakeBackends([{ info: accountSource }])
    await onSubmitted(backends, TAB, 0, login)
    const session = await prompts.get(TAB)
    expect(session).toMatchObject({
      mode: "save",
      username: "someone",
      update: null,
    })
    expect(session?.token).toBeTruthy()
    expect(pageModule.sendToFrame).toHaveBeenCalledWith(TAB, 0, {
      type: "prompt.show",
      token: expect.any(String),
    })
  })

  it("offers to update a login whose saved password differs", async () => {
    const { backends } = fakeBackends([
      {
        info: accountSource,
        existing: { loginId: "item-1", samePassword: false },
      },
    ])
    await onSubmitted(backends, TAB, 0, login)
    expect(await prompts.get(TAB)).toMatchObject({
      mode: "update",
      update: { sourceId: accountSource.id, loginId: "item-1" },
    })
  })

  it("stays quiet when a source already has the login, including Apple without its password", async () => {
    for (const existing of [
      { loginId: "item-1", samePassword: true },
      { loginId: "apple-1", samePassword: undefined },
    ]) {
      const { backends } = fakeBackends([
        { info: accountSource },
        { info: appleSource, existing },
      ])
      await onSubmitted(backends, TAB, 0, login)
      expect(await prompts.get(TAB)).toBeNull()
    }
  })

  it("does not offer to save when no ready source can store a login for the site", async () => {
    const { backends } = fakeBackends([
      { info: appleSource, canSave: false },
      { info: { ...accountSource, status: "locked" } },
    ])
    await onSubmitted(backends, TAB, 0, login)
    expect(await prompts.get(TAB)).toBeNull()
    expect(pageModule.sendToFrame).not.toHaveBeenCalled()
  })

  it("offers only the sources that can store a login for the site", async () => {
    const { backends } = fakeBackends([
      { info: appleSource, canSave: false },
      { info: accountSource },
    ])
    await onSubmitted(backends, TAB, 0, login)
    const state = await promptState(backends, TAB)
    expect(state.targets.map((t) => t.id)).toEqual([accountSource.id])
    expect(state.defaultTarget).toBe(accountSource.id)
  })

  it("respects the settings and site rules that turn prompts off", async () => {
    const { backends } = fakeBackends([{ info: accountSource }])
    await updateSettings({ askSave: false })
    await onSubmitted(backends, TAB, 0, login)
    expect(await prompts.get(TAB)).toBeNull()

    await updateSettings({
      askSave: true,
      siteRules: [
        {
          id: "r",
          host: "example.com",
          match: null,
          backend: "all",
          behavior: "noSave",
        },
      ],
    })
    await onSubmitted(backends, TAB, 0, login)
    expect(await prompts.get(TAB)).toBeNull()
  })

  it("joins the username of the first page of a two-step login with the password of the second", async () => {
    const { backends } = fakeBackends([{ info: accountSource }])
    await onSubmitted(backends, TAB, 0, { username: "someone", password: "" })
    expect(await prompts.get(TAB)).toBeNull()
    setFrame(TAB, 0, "https://login.example.com/password")
    await onSubmitted(backends, TAB, 0, {
      username: "",
      password: "typed-password",
    })
    expect(await prompts.get(TAB)).toMatchObject({ username: "someone" })
  })

  it("does not carry a remembered username to another site", async () => {
    const { backends } = fakeBackends([{ info: accountSource }])
    await onSubmitted(backends, TAB, 0, { username: "someone", password: "" })
    setFrame(TAB, 0, "https://other.org/login")
    await onSubmitted(backends, TAB, 0, {
      username: "",
      password: "typed-password",
    })
    expect(await prompts.get(TAB)).toBeNull()
  })
})

describe("showPrompt", () => {
  it("shows a pending prompt again only on the site of the login, with a new token", async () => {
    const { backends } = fakeBackends([{ info: accountSource }])
    await onSubmitted(backends, TAB, 0, login)
    const first = (await prompts.get(TAB))?.token
    pageModule.sendToFrame.mockClear()

    setFrame(TAB, 0, "https://unrelated.net/")
    await showPrompt(TAB)
    expect(pageModule.sendToFrame).not.toHaveBeenCalled()

    setFrame(TAB, 0, "https://www.example.com/home")
    await showPrompt(TAB)
    expect(pageModule.sendToFrame).toHaveBeenCalledTimes(1)
    expect((await prompts.get(TAB))?.token).not.toBe(first)
  })
})

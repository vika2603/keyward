import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { updateSettings } from "@/lib/settings"
import { prompts } from "./overlays"
import { onSubmitted, promptState, showPrompt } from "./save-flow"
import {
  accountVault,
  appleVault,
  fakeProviders,
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
  it("offers to save a login that no vault has", async () => {
    const { providers } = fakeProviders([{ info: accountVault }])
    await onSubmitted(providers, TAB, 0, login)
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
    const { providers } = fakeProviders([
      {
        info: accountVault,
        existing: { loginId: "item-1", samePassword: false },
      },
    ])
    await onSubmitted(providers, TAB, 0, login)
    expect(await prompts.get(TAB)).toMatchObject({
      mode: "update",
      update: { vaultId: accountVault.id, loginId: "item-1" },
    })
  })

  it("stays quiet when a vault already has the login, including Apple without its password", async () => {
    for (const existing of [
      { loginId: "item-1", samePassword: true },
      { loginId: "apple-1", samePassword: undefined },
    ]) {
      const { providers } = fakeProviders([
        { info: accountVault },
        { info: appleVault, existing },
      ])
      await onSubmitted(providers, TAB, 0, login)
      expect(await prompts.get(TAB)).toBeNull()
    }
  })

  it("offers to update an Apple login when a new password was typed for it", async () => {
    const { providers } = fakeProviders([
      {
        info: appleVault,
        existing: { loginId: "apple-1", samePassword: undefined },
      },
    ])
    await onSubmitted(providers, TAB, 0, { ...login, newPassword: true })
    expect(await prompts.get(TAB)).toMatchObject({
      mode: "update",
      update: { vaultId: appleVault.id, loginId: "apple-1" },
    })
  })

  it("names the site's only account when a change-password form does not", async () => {
    const saved = { id: "item-1", username: "someone", title: "Example" }
    const changed = {
      username: "",
      password: "typed-password",
      newPassword: true,
    }
    const { providers } = fakeProviders([
      {
        info: accountVault,
        logins: [saved],
        existing: { loginId: "item-1", samePassword: false },
      },
    ])
    await onSubmitted(providers, TAB, 0, changed)
    expect(await prompts.get(TAB)).toMatchObject({
      mode: "update",
      username: "someone",
    })

    await prompts.remove(TAB)
    const two = fakeProviders([
      {
        info: accountVault,
        logins: [saved, { ...saved, id: "item-2", username: "another" }],
      },
    ])
    await onSubmitted(two.providers, TAB, 0, changed)
    expect(await prompts.get(TAB)).toBeNull()
  })

  it("does not offer to save when no ready vault can store a login for the site", async () => {
    const { providers } = fakeProviders([
      { info: appleVault, canSave: false },
      { info: { ...accountVault, status: "locked" } },
    ])
    await onSubmitted(providers, TAB, 0, login)
    expect(await prompts.get(TAB)).toBeNull()
    expect(pageModule.sendToFrame).not.toHaveBeenCalled()
  })

  it("offers only the vaults that can store a login for the site", async () => {
    const { providers } = fakeProviders([
      { info: appleVault, canSave: false },
      { info: accountVault },
    ])
    await onSubmitted(providers, TAB, 0, login)
    const state = await promptState(providers, TAB)
    expect(state.targets.map((t) => t.id)).toEqual([accountVault.id])
    expect(state.defaultTarget).toBe(accountVault.id)
  })

  it("respects the settings and site rules that turn prompts off", async () => {
    const { providers } = fakeProviders([{ info: accountVault }])
    await updateSettings({ askSave: false })
    await onSubmitted(providers, TAB, 0, login)
    expect(await prompts.get(TAB)).toBeNull()

    await updateSettings({
      askSave: true,
      siteRules: [
        {
          id: "r",
          host: "example.com",
          match: null,
          provider: "all",
          behavior: "noSave",
        },
      ],
    })
    await onSubmitted(providers, TAB, 0, login)
    expect(await prompts.get(TAB)).toBeNull()
  })

  it("joins the username of the first page of a two-step login with the password of the second", async () => {
    const { providers } = fakeProviders([{ info: accountVault }])
    await onSubmitted(providers, TAB, 0, { username: "someone", password: "" })
    expect(await prompts.get(TAB)).toBeNull()
    setFrame(TAB, 0, "https://login.example.com/password")
    await onSubmitted(providers, TAB, 0, {
      username: "",
      password: "typed-password",
    })
    expect(await prompts.get(TAB)).toMatchObject({ username: "someone" })
  })

  it("does not carry a remembered username to another site", async () => {
    const { providers } = fakeProviders([{ info: accountVault }])
    await onSubmitted(providers, TAB, 0, { username: "someone", password: "" })
    setFrame(TAB, 0, "https://other.org/login")
    await onSubmitted(providers, TAB, 0, {
      username: "",
      password: "typed-password",
    })
    expect(await prompts.get(TAB)).toBeNull()
  })
})

describe("showPrompt", () => {
  it("shows a pending prompt again only on the site of the login, with a new token", async () => {
    const { providers } = fakeProviders([{ info: accountVault }])
    await onSubmitted(providers, TAB, 0, login)
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

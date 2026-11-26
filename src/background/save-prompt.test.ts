import { beforeEach, describe, expect, it, vi } from "vitest"
import { getSettings, MatchType, updateSettings } from "@/lib/settings"
import { forgetFill, rememberFill } from "./filled-logins"
import { type PromptSession, promptSessions } from "./overlays"
import {
  confirmPrompt,
  neverForSite,
  onSubmitted,
  promptFolders,
  promptState,
  showPrompt,
} from "./save-prompt"
import {
  accountVault,
  appleVault,
  fakeProviders,
  pageModule,
  resetBackground,
  setFrame,
  siteRule,
} from "./test-support"

vi.mock("./page", async () => (await import("./test-support")).pageModule)

const TAB = 7
const login = { username: "someone", password: "typed-password" }

/** The tab's pending prompt, as the prompt's requests claim it. */
async function pendingPrompt(): Promise<PromptSession> {
  const session = await promptSessions.get(TAB)
  if (!session) throw new Error("No prompt is pending")
  return session
}

beforeEach(() => {
  resetBackground()
  forgetFill(TAB)
  setFrame(TAB, 0, "https://accounts.example.com/login")
})

describe("onSubmitted", () => {
  it("offers to save a login that no vault has", async () => {
    const { providers } = fakeProviders([{ info: accountVault }])
    await onSubmitted(providers, TAB, 0, login)
    const session = await promptSessions.get(TAB)
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
    expect(await promptSessions.get(TAB)).toMatchObject({
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
      expect(await promptSessions.get(TAB)).toBeNull()
    }
  })

  it("neither updates nor saves again a login the vault keeps but Keyward may not change", async () => {
    const { providers } = fakeProviders([
      {
        info: accountVault,
        existing: { loginId: "item-1", samePassword: false, editable: false },
      },
    ])
    await onSubmitted(providers, TAB, 0, login)
    expect(await promptSessions.get(TAB)).toBeNull()
  })

  it("offers to update an Apple login when a new password was typed for it", async () => {
    const { providers } = fakeProviders([
      {
        info: appleVault,
        existing: { loginId: "apple-1", samePassword: undefined },
      },
    ])
    await onSubmitted(providers, TAB, 0, { ...login, newPassword: true })
    expect(await promptSessions.get(TAB)).toMatchObject({
      mode: "update",
      update: { vaultId: appleVault.id, loginId: "apple-1" },
    })
  })

  it("offers to update an Apple login whose password Keyward filled and the user then changed", async () => {
    const { providers } = fakeProviders([
      {
        info: appleVault,
        existing: { loginId: "apple-1", samePassword: undefined },
      },
    ])
    await rememberFill(TAB, "example.com", appleVault.id, "apple-1", "old")
    await onSubmitted(providers, TAB, 0, login)
    expect(await promptSessions.get(TAB)).toMatchObject({
      mode: "update",
      update: { vaultId: appleVault.id, loginId: "apple-1" },
    })
  })

  it("stays quiet about an Apple login submitted with the password Keyward filled", async () => {
    const { providers } = fakeProviders([
      {
        info: appleVault,
        existing: { loginId: "apple-1", samePassword: undefined },
      },
    ])
    await rememberFill(
      TAB,
      "example.com",
      appleVault.id,
      "apple-1",
      login.password,
    )
    await onSubmitted(providers, TAB, 0, login)
    expect(await promptSessions.get(TAB)).toBeNull()
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
    expect(await promptSessions.get(TAB)).toMatchObject({
      mode: "update",
      username: "someone",
    })

    await promptSessions.remove(TAB)
    const two = fakeProviders([
      {
        info: accountVault,
        logins: [saved, { ...saved, id: "item-2", username: "another" }],
      },
    ])
    await onSubmitted(two.providers, TAB, 0, changed)
    expect(await promptSessions.get(TAB)).toBeNull()
  })

  it("does not offer to save when no ready vault can store a login for the site", async () => {
    const { providers } = fakeProviders([
      { info: appleVault, canSave: false },
      { info: { ...accountVault, status: "locked" } },
    ])
    await onSubmitted(providers, TAB, 0, login)
    expect(await promptSessions.get(TAB)).toBeNull()
    expect(pageModule.sendToFrame).not.toHaveBeenCalled()
  })

  it("offers only the vaults that can store a login for the site", async () => {
    const { providers } = fakeProviders([
      { info: appleVault, canSave: false },
      { info: accountVault },
    ])
    await onSubmitted(providers, TAB, 0, login)
    const state = await promptState(providers, await pendingPrompt())
    expect(state.targets.map((t) => t.id)).toEqual([accountVault.id])
    expect(state.defaultTarget).toBe(accountVault.id)
  })

  it("leaves out a vault told never to save logins for the site, and stays quiet when none is left", async () => {
    const both = fakeProviders([
      { info: appleVault, refusesSaving: true },
      { info: accountVault },
    ])
    await onSubmitted(both.providers, TAB, 0, login)
    const state = await promptState(both.providers, await pendingPrompt())
    expect(state.targets.map((target) => target.id)).toEqual([accountVault.id])

    await promptSessions.remove(TAB)
    const appleOnly = fakeProviders([{ info: appleVault, refusesSaving: true }])
    await onSubmitted(appleOnly.providers, TAB, 0, login)
    expect(await promptSessions.get(TAB)).toBeNull()
  })

  it("respects the settings and site rules that turn prompts off", async () => {
    const { providers } = fakeProviders([{ info: accountVault }])
    await updateSettings({ askSave: false })
    await onSubmitted(providers, TAB, 0, login)
    expect(await promptSessions.get(TAB)).toBeNull()

    await updateSettings({
      askSave: true,
      siteRules: [siteRule("noSave")],
    })
    await onSubmitted(providers, TAB, 0, login)
    expect(await promptSessions.get(TAB)).toBeNull()
  })

  it("joins the username of the first page of a two-step login with the password of the second", async () => {
    const { providers } = fakeProviders([{ info: accountVault }])
    await onSubmitted(providers, TAB, 0, { username: "someone", password: "" })
    expect(await promptSessions.get(TAB)).toBeNull()
    setFrame(TAB, 0, "https://login.example.com/password")
    await onSubmitted(providers, TAB, 0, {
      username: "",
      password: "typed-password",
    })
    expect(await promptSessions.get(TAB)).toMatchObject({ username: "someone" })
  })

  it("takes the account the page names when the step before named none", async () => {
    const { providers } = fakeProviders([{ info: accountVault }])
    const onPage = {
      username: "",
      password: "typed-password",
      usernameOnPage: "shown@example.com",
    }
    await onSubmitted(providers, TAB, 0, onPage)
    expect(await promptSessions.get(TAB)).toMatchObject({
      username: "shown@example.com",
    })
    // The username typed on the step before is surer than what the page shows.
    await promptSessions.remove(TAB)
    await onSubmitted(providers, TAB, 0, { username: "someone", password: "" })
    await onSubmitted(providers, TAB, 0, onPage)
    expect(await promptSessions.get(TAB)).toMatchObject({ username: "someone" })
  })

  it("does not carry a remembered username to another site", async () => {
    const { providers } = fakeProviders([{ info: accountVault }])
    await onSubmitted(providers, TAB, 0, { username: "someone", password: "" })
    setFrame(TAB, 0, "https://other.org/login")
    await onSubmitted(providers, TAB, 0, {
      username: "",
      password: "typed-password",
    })
    expect(await promptSessions.get(TAB)).toBeNull()
  })
})

describe("neverForSite", () => {
  it("keeps the vaults and match type of a parent domain's rule in the subdomain's new rule", async () => {
    const parentRule = {
      id: "parent",
      host: "example.com",
      match: MatchType.Host,
      provider: "bitwarden",
      behavior: "menuOnClick",
    } as const
    await updateSettings({ siteRules: [parentRule] })
    const { providers } = fakeProviders([{ info: accountVault }])
    await onSubmitted(providers, TAB, 0, login)
    await neverForSite(await pendingPrompt())
    const { siteRules } = await getSettings()
    expect(siteRules).toEqual([
      parentRule,
      {
        id: expect.any(String),
        host: "accounts.example.com",
        match: MatchType.Host,
        provider: "bitwarden",
        behavior: "noSave",
      },
    ])
    expect(await promptSessions.get(TAB)).toBeNull()
  })

  it("changes the host's own rule instead of adding one", async () => {
    await updateSettings({
      siteRules: [
        {
          id: "own",
          host: "accounts.example.com",
          match: null,
          provider: "apple",
          behavior: "menuOnFocus",
        },
      ],
    })
    const { providers } = fakeProviders([{ info: appleVault }])
    await onSubmitted(providers, TAB, 0, login)
    await neverForSite(await pendingPrompt())
    expect((await getSettings()).siteRules).toEqual([
      {
        id: "own",
        host: "accounts.example.com",
        match: null,
        provider: "apple",
        behavior: "noSave",
      },
    ])
  })
})

describe("confirmPrompt", () => {
  it("saves the login with the name and folder chosen in the prompt", async () => {
    const { providers, calls } = fakeProviders([{ info: accountVault }])
    await onSubmitted(providers, TAB, 0, login)
    await confirmPrompt(providers, await pendingPrompt(), accountVault.id, {
      name: "Accounts",
      folderId: "folder-1",
    })
    expect(calls.save).toHaveBeenCalledWith(
      accountVault.id,
      expect.objectContaining({
        username: "someone",
        password: "typed-password",
        details: expect.objectContaining({
          name: "Accounts",
          folderId: "folder-1",
        }),
      }),
    )
  })

  it("lists folders only for a vault the prompt offers", async () => {
    const { providers } = fakeProviders([{ info: accountVault }])
    await onSubmitted(providers, TAB, 0, login)
    await expect(
      promptFolders(providers, await pendingPrompt(), "bitwarden:other"),
    ).resolves.toEqual([])
  })
})

describe("showPrompt", () => {
  it("shows a pending prompt again only on the site of the login, with a new token", async () => {
    const { providers } = fakeProviders([{ info: accountVault }])
    await onSubmitted(providers, TAB, 0, login)
    const first = (await promptSessions.get(TAB))?.token
    pageModule.sendToFrame.mockClear()

    setFrame(TAB, 0, "https://unrelated.net/")
    await showPrompt(TAB)
    expect(pageModule.sendToFrame).not.toHaveBeenCalled()

    setFrame(TAB, 0, "https://www.example.com/home")
    await showPrompt(TAB)
    expect(pageModule.sendToFrame).toHaveBeenCalledTimes(1)
    expect((await promptSessions.get(TAB))?.token).not.toBe(first)
  })
})

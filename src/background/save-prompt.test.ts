import { beforeEach, describe, expect, it, vi } from "vitest"
import { getSettings, MatchType, updateSettings } from "@/lib/settings"
import { forgetFill, rememberFill } from "./filled-logins"
import { type PromptSession, promptSessions } from "./overlays"
import { forgetGenerated, rememberGenerated } from "./recent-generated"
import {
  confirmPrompt,
  neverForSite,
  onSubmitted,
  promptFolders,
  promptState,
  refreshLockedPrompts,
  showPrompt,
  unlockAndSavePrompt,
} from "./save-prompt"
import {
  accountVault,
  appleVault,
  fakeProviders,
  idleNamedProviders,
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

beforeEach(async () => {
  resetBackground()
  forgetFill(TAB)
  await forgetGenerated(TAB)
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

describe("Phase 2 save & update matrix, editable prompt, locked deferral and generated cache", () => {
  it("matches the right account on a multi-account change-password form using currentPassword", async () => {
    const { providers } = fakeProviders([
      {
        info: accountVault,
        logins: [
          { id: "id-alice", username: "alice", title: "Example" },
          { id: "id-bob", username: "bob", title: "Example" },
        ],
        findExisting: (_page, username, password) => {
          if (username === "alice")
            return {
              loginId: "id-alice",
              samePassword: password === "alice-old",
            }
          if (username === "bob")
            return { loginId: "id-bob", samePassword: password === "bob-old" }
          return null
        },
      },
    ])
    await onSubmitted(providers, TAB, 0, {
      username: "",
      password: "bob-new-password",
      currentPassword: "bob-old",
      newPassword: true,
    })
    expect(await promptSessions.get(TAB)).toMatchObject({
      mode: "update",
      username: "bob",
      password: "bob-new-password",
      update: { vaultId: accountVault.id, loginId: "id-bob" },
    })
  })

  it("stays quiet on a change-password form without username when current and new passwords match", async () => {
    const { providers } = fakeProviders([
      {
        info: accountVault,
        logins: [{ id: "id-alice", username: "alice", title: "Example" }],
        existing: { loginId: "id-alice", samePassword: true },
      },
    ])
    await onSubmitted(providers, TAB, 0, {
      username: "",
      password: "same-password",
      currentPassword: "same-password",
      newPassword: true,
    })
    expect(await promptSessions.get(TAB)).toBeNull()
  })

  it("exposes password in promptState and saves user-edited username and password", async () => {
    const { providers, calls } = fakeProviders([{ info: accountVault }])
    await onSubmitted(providers, TAB, 0, login)
    const session = await pendingPrompt()
    const state = await promptState(providers, session)
    expect(state.password).toBe(login.password)

    await confirmPrompt(providers, session, accountVault.id, {
      name: "Work",
      folderId: null,
      username: "edited@example.com",
      password: "edited-password",
    })
    expect(calls.save).toHaveBeenCalledWith(
      accountVault.id,
      expect.objectContaining({
        username: "edited@example.com",
        password: "edited-password",
      }),
    )
  })

  it("offers a locked prompt when all vaults are locked and auto-saves after inline Bitwarden unlock", async () => {
    const lockedVault = { ...accountVault, status: "locked" as const }
    const vaults: { info: typeof accountVault }[] = [{ info: lockedVault }]
    const { providers, calls } = fakeProviders(vaults)
    await onSubmitted(providers, TAB, 0, login)

    const session = await pendingPrompt()
    expect(session.mode).toBe("locked")
    const state = await promptState(providers, session)
    expect(state.lockedVaults).toEqual([lockedVault])

    const named = idleNamedProviders()
    vi.spyOn(named.bitwarden, "unlock").mockImplementation(async () => {
      vaults[0] = { info: { ...lockedVault, status: "ready" } }
    })

    const result = await unlockAndSavePrompt(
      providers,
      named.bitwarden,
      session,
      {
        vaultId: lockedVault.id,
        masterPassword: "master-password",
        username: "alice-edited",
        password: "typed-password",
        name: "My Account",
      },
    )
    expect(result).toEqual({ completed: true })
    expect(named.bitwarden.unlock).toHaveBeenCalledWith("a", "master-password")
    expect(calls.save).toHaveBeenCalledWith(
      lockedVault.id,
      expect.objectContaining({
        username: "alice-edited",
        password: "typed-password",
      }),
    )
    expect(await promptSessions.get(TAB)).toBeNull()
  })

  it("transitions an externally unlocked locked prompt to save mode", async () => {
    const vaults: { info: typeof accountVault }[] = [
      { info: { ...accountVault, status: "locked" } },
    ]
    const { providers } = fakeProviders(vaults)
    await onSubmitted(providers, TAB, 0, login)
    expect((await pendingPrompt()).mode).toBe("locked")

    vaults[0] = { info: { ...accountVault, status: "ready" } }
    await refreshLockedPrompts(providers)
    expect((await pendingPrompt()).mode).toBe("save")
  })

  it("treats a submitted cached generated password as newPassword and recovers it on same-page submit", async () => {
    const page = new URL("https://accounts.example.com/login")
    await rememberGenerated(TAB, "example.com", page, "GenPass!234", true)

    const { providers } = fakeProviders([
      {
        info: appleVault,
        existing: { loginId: "apple-1", samePassword: undefined },
      },
    ])
    // Even without newPassword flag from the DOM, matching the cached generated password forces update.
    await onSubmitted(providers, TAB, 0, {
      username: "someone",
      password: "GenPass!234",
      newPassword: false,
    })
    expect(await promptSessions.get(TAB)).toMatchObject({
      mode: "update",
      password: "GenPass!234",
    })

    // Same-page submit where password field was cleared still recovers the filled generated password.
    await promptSessions.remove(TAB)
    await onSubmitted(providers, TAB, 0, {
      username: "someone",
      password: "",
    })
    expect(await promptSessions.get(TAB)).toMatchObject({
      mode: "update",
      password: "GenPass!234",
    })
  })
})

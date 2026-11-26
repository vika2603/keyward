import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { updateSettings } from "@/lib/settings"
import { AppleProvider, passwordIn } from "./apple-provider"

describe("passwordIn", () => {
  const entry = (USR: string, PWD?: string) => ({
    USR,
    sites: ["github.com"],
    ...(PWD === undefined ? {} : { PWD }),
  })

  it("reads the password of the login asked for", () => {
    const reply = { STATUS: 0, Entries: [entry("other"), entry("me", "pw")] }
    expect(passwordIn(reply, "me", "github.com")).toBe("pw")
  })

  it("reports no password when the helper holds none for the login", () => {
    expect(
      passwordIn({ STATUS: 0, Entries: [entry("me")] }, "me", "github.com"),
    ).toBeNull()
    expect(
      passwordIn({ STATUS: 0, Entries: [entry("me", "")] }, "me", "github.com"),
    ).toBeNull()
    expect(passwordIn({ STATUS: 3 }, "me", "github.com")).toBeNull()
  })

  it("does not judge the login from an answer about other logins", () => {
    const reply = { STATUS: 0, Entries: [entry("other", "pw")] }
    expect(passwordIn(reply, "me", "github.com")).toBeUndefined()
  })
})

describe("AppleProvider.canSave", () => {
  const apple = new AppleProvider()
  const canSave = (url: string) => apple.canSave(new URL(url))

  it("accepts hosts under public suffixes", () => {
    expect(canSave("https://github.com/login")).toBe(true)
    expect(canSave("https://accounts.example.co.uk/")).toBe(true)
    expect(canSave("https://keyward-test.example.com/")).toBe(true)
  })

  it("refuses local and reserved names that Apple Passwords does not store", () => {
    expect(canSave("http://keyward-test.localhost:8765/")).toBe(false)
    expect(canSave("http://printer.local/")).toBe(false)
    expect(canSave("https://site.test/")).toBe(false)
    expect(canSave("https://keyward-test.example/")).toBe(false)
    expect(canSave("http://intranet/")).toBe(false)
  })
})

describe("AppleProvider.logins", () => {
  beforeEach(() => fakeBrowser.reset())

  it("lists the logins of sites the settings make equivalent to the page's", async () => {
    await updateSettings({
      equivalentDomains: [["example.com", "www.example.org"]],
    })
    const apple = new AppleProvider()
    const listings: Record<string, { username: string; site: string }[]> = {
      "accounts.example.com": [{ username: "me", site: "example.com" }],
      "example.org": [
        { username: "me", site: "example.com" },
        { username: "other", site: "example.org" },
      ],
    }
    const listEntries = vi
      .spyOn(
        apple as unknown as {
          listEntries: (host: string) => Promise<unknown[]>
        },
        "listEntries",
      )
      .mockImplementation(async (host) =>
        (listings[host] ?? []).map((entry) => ({
          ...entry,
          sites: [entry.site],
        })),
      )
    const logins = await apple.logins(
      "apple",
      new URL("https://accounts.example.com/login"),
    )
    expect(listEntries.mock.calls.map(([host]) => host)).toEqual([
      "accounts.example.com",
      "example.org",
    ])
    expect(logins.map((login) => [login.username, login.host])).toEqual([
      ["me", "example.com"],
      ["other", "example.org"],
    ])
  })
})

/** The provider's private parts these tests stand in for or look at. */
interface ProviderInternals {
  query: (
    envelope: { cmd: number },
    ...rest: unknown[]
  ) => Promise<Record<string, unknown>>
  capabilities: Record<string, unknown> | null
  port: { connected: boolean; post: (message: unknown) => void }
  state: { phase: string }
  pairing: object | null
  onUnsolicited: (message: { cmd: number }) => void
}

function internalsOf(apple: AppleProvider): ProviderInternals {
  return apple as unknown as ProviderInternals
}

describe("AppleProvider.refusesSaving", () => {
  const listing = (...users: string[]) => ({
    STATUS: 0,
    Entries: users.map((USR) => ({
      USR,
      PWD: "Not Included",
      sites: ["example.com"],
    })),
  })

  it("tells a site set never to save, while its logins are still listed", async () => {
    const apple = new AppleProvider()
    vi.spyOn(internalsOf(apple), "query").mockResolvedValue(
      listing("someone", "Passwords\u00a0not\u00a0saved"),
    )
    const page = new URL("https://example.com/login")
    expect(await apple.refusesSaving("apple", page)).toBe(true)
    expect(
      (await apple.logins("apple", page)).map((login) => login.username),
    ).toEqual(["someone"])
  })

  it("takes a site with only logins as one that saves", async () => {
    const apple = new AppleProvider()
    vi.spyOn(internalsOf(apple), "query").mockResolvedValue(listing("someone"))
    expect(
      await apple.refusesSaving("apple", new URL("https://example.com/")),
    ).toBe(false)
  })
})

describe("AppleProvider.cancelPairing", () => {
  function waitingForCode() {
    const apple = new AppleProvider()
    const internals = internalsOf(apple)
    const post = vi.fn()
    Object.assign(internals, {
      port: { connected: true, post },
      state: { phase: "awaitingCode" },
      pairing: {},
    })
    return { apple, internals, post }
  }

  it("tells the helper to close its code window and forgets the attempt", async () => {
    const { apple, post } = waitingForCode()
    await apple.cancelPairing()
    expect(post).toHaveBeenCalledWith({ cmd: 19 })
    expect(apple.getState().phase).toBe("unpaired")
  })

  it("leaves the pairing alone when a view wants the code again by then", async () => {
    const { apple, post } = waitingForCode()
    await apple.cancelPairing(() => true)
    expect(post).not.toHaveBeenCalled()
    expect(apple.getState().phase).toBe("awaitingCode")
  })

  it("sends nothing once paired", async () => {
    const { apple, internals, post } = waitingForCode()
    internals.state = { phase: "paired" }
    await apple.cancelPairing()
    expect(post).not.toHaveBeenCalled()
  })
})

describe("AppleProvider.onCodesChanged", () => {
  it("passes on the helper's word that its verification codes changed", () => {
    const apple = new AppleProvider()
    const listener = vi.fn()
    apple.onCodesChanged(listener)
    internalsOf(apple).onUnsolicited({ cmd: 15 })
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe("AppleProvider.save", () => {
  const tab = { tabId: 1, frameId: 0 }
  const url = new URL("https://example.com/")

  /** A helper whose listing turns from `before` into `after` once asked to save. */
  function saving(before: string[], after: string[]) {
    const apple = new AppleProvider()
    const internals = internalsOf(apple)
    internals.capabilities = { canSaveAccountWithEmptyUserName: true }
    let listed = before
    vi.spyOn(internals, "query").mockImplementation(async ({ cmd }) => {
      if (cmd === 6) {
        listed = after
        return { STATUS: 0 }
      }
      return {
        STATUS: 0,
        Entries: listed.map((USR) => ({ USR, sites: ["example.com"] })),
      }
    })
    return apple
  }

  async function saveOutcome(apple: AppleProvider, username: string) {
    vi.useFakeTimers()
    try {
      const outcome = apple
        .save("apple", { url, username, password: "pw" }, tab)
        .then(
          () => "stored",
          (error: { code: string }) => error.code,
        )
      await vi.runAllTimersAsync()
      return await outcome
    } finally {
      vi.useRealTimers()
    }
  }

  it("takes a new entry as stored when macOS asked for the user name", async () => {
    const apple = saving(["someone"], ["someone", "typed-on-the-mac"])
    expect(await saveOutcome(apple, "")).toBe("stored")
  })

  it("cannot tell an unchanged listing apart when no user name was sent", async () => {
    const apple = saving(["someone"], ["someone"])
    expect(await saveOutcome(apple, "")).toBe("apple.saveUnconfirmed")
  })

  it("refuses a login without a password before asking the helper", async () => {
    const apple = saving([], ["me"])
    const query = vi.spyOn(internalsOf(apple), "query")
    await expect(
      apple.save("apple", { url, username: "me", password: "" }, tab),
    ).rejects.toMatchObject({ code: "apple.emptyPassword" })
    expect(query).not.toHaveBeenCalled()
  })

  it("reports a named login the listing lacks as not stored", async () => {
    const apple = saving(["someone"], ["someone"])
    expect(await saveOutcome(apple, "me")).toBe("apple.notSaved")
  })
})

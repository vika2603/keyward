import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { updateSettings } from "@/lib/settings"
import { AppleProvider } from "./apple-provider"
import type { HelperCapabilities } from "./protocol"
import { Cmd } from "./protocol"

/** A provider whose helper answers each query with `answer`; nothing reaches a real helper. */
function providerAnswering(
  answer: (envelope: { cmd: number; url?: unknown }) => Record<string, unknown>,
  capabilities: HelperCapabilities = {},
) {
  const apple = new AppleProvider()
  const query = vi
    .spyOn(apple.helper, "query")
    .mockImplementation(async (envelope) => answer(envelope))
  vi.spyOn(apple.helper, "capabilities", "get").mockReturnValue(capabilities)
  return { apple, query }
}

/** A listing reply with one login per username, saved for `site`. */
function listing(site: string, ...users: string[]) {
  return {
    STATUS: 0,
    Entries: users.map((USR) => ({ USR, PWD: "Not Included", sites: [site] })),
  }
}

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
    const listings: Record<string, { username: string; site: string }[]> = {
      "accounts.example.com": [{ username: "me", site: "example.com" }],
      "example.org": [
        { username: "me", site: "example.com" },
        { username: "other", site: "example.org" },
      ],
    }
    const { apple, query } = providerAnswering(({ url }) => ({
      STATUS: 0,
      Entries: (listings[String(url)] ?? []).map((entry) => ({
        USR: entry.username,
        sites: [entry.site],
      })),
    }))
    const logins = await apple.logins(
      "apple",
      new URL("https://accounts.example.com/login"),
    )
    expect(query.mock.calls.map(([envelope]) => envelope.url)).toEqual([
      "accounts.example.com",
      "example.org",
    ])
    expect(logins.map((login) => [login.username, login.host])).toEqual([
      ["me", "example.com"],
      ["other", "example.org"],
    ])
  })

  it("lists only the logins of a subdomain Apple's list shares, not its parent domain's", async () => {
    const listings: Record<string, { username: string; site: string }[]> = {
      "shop.univision.com": [
        { username: "shopper", site: "shop.univision.com" },
        { username: "viewer", site: "univision.com" },
      ],
    }
    const { apple } = providerAnswering(({ url }) => ({
      STATUS: 0,
      Entries: (listings[String(url)] ?? []).map((entry) => ({
        USR: entry.username,
        sites: [entry.site],
      })),
    }))
    const logins = await apple.logins("apple", new URL("https://meh.com/"))
    expect(logins.map((login) => [login.username, login.host])).toEqual([
      ["shopper", "shop.univision.com"],
    ])
  })
})

describe("AppleProvider.refusesSaving", () => {
  it("tells a site set never to save, while its logins are still listed", async () => {
    const { apple } = providerAnswering(() =>
      listing("example.com", "someone", "Passwords not saved"),
    )
    const page = new URL("https://example.com/login")
    expect(await apple.refusesSaving("apple", page)).toBe(true)
    expect(
      (await apple.logins("apple", page)).map((login) => login.username),
    ).toEqual(["someone"])
  })

  it("takes a site with only logins as one that saves", async () => {
    const { apple } = providerAnswering(() => listing("example.com", "someone"))
    expect(
      await apple.refusesSaving("apple", new URL("https://example.com/")),
    ).toBe(false)
  })
})

describe("AppleProvider.save", () => {
  const tab = { tabId: 1, frameId: 0 }
  const url = new URL("https://example.com/")

  /** A helper whose listing turns from `before` into `after` once asked to save. */
  function saving(before: string[], after: string[]) {
    let listed = before
    return providerAnswering(
      ({ cmd }) => {
        if (cmd !== Cmd.SetPasswordForLoginNameAndUrl)
          return listing("example.com", ...listed)
        listed = after
        return { STATUS: 0 }
      },
      { canSaveAccountWithEmptyUserName: true },
    )
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
    const { apple } = saving(["someone"], ["someone", "typed-on-the-mac"])
    expect(await saveOutcome(apple, "")).toBe("stored")
  })

  it("cannot tell an unchanged listing apart when no user name was sent", async () => {
    const { apple } = saving(["someone"], ["someone"])
    expect(await saveOutcome(apple, "")).toBe("apple.saveUnconfirmed")
  })

  it("takes a user name of only spaces as none", async () => {
    const { apple, query } = saving(["someone"], ["someone"])
    expect(await saveOutcome(apple, "  ")).toBe("apple.saveUnconfirmed")
    const offered = query.mock.calls.find(
      ([envelope]) => envelope.cmd === Cmd.SetPasswordForLoginNameAndUrl,
    )
    expect(offered?.[2]).toMatchObject({ NUSR: "" })
  })

  it("refuses a login without a password before asking the helper", async () => {
    const { apple, query } = saving([], ["me"])
    await expect(
      apple.save("apple", { url, username: "me", password: "" }, tab),
    ).rejects.toMatchObject({ code: "apple.emptyPassword" })
    expect(query).not.toHaveBeenCalled()
  })

  it("reports a named login the listing lacks as not stored", async () => {
    const { apple } = saving(["someone"], ["someone"])
    expect(await saveOutcome(apple, "me")).toBe("apple.notSaved")
  })
})

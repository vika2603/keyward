import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { updateSettings } from "@/lib/settings"
import { AppleProvider } from "./apple-provider"
import type { SiteListing } from "./helper-api"
import type { HelperCapabilities } from "./protocol"

/** A provider whose helper lists what `listingOf` gives for each host; nothing reaches a real helper. */
function providerListing(
  listingOf: (host: string) => SiteListing,
  capabilities: HelperCapabilities = {},
) {
  const apple = new AppleProvider()
  const listLogins = vi
    .spyOn(apple.api, "listLogins")
    .mockImplementation(async (host) => listingOf(host))
  const offerLogin = vi
    .spyOn(apple.api, "offerLogin")
    .mockResolvedValue(undefined)
  vi.spyOn(apple.helper, "capabilities", "get").mockReturnValue(capabilities)
  return { apple, listLogins, offerLogin }
}

/** A listing with one login per username, each saved for its own site. */
function listing(...logins: [username: string, site: string][]): SiteListing {
  return {
    logins: logins.map(([username, site]) => ({
      username,
      site,
      sites: [site],
    })),
    neverSaved: false,
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
    const listings: Record<string, SiteListing> = {
      "accounts.example.com": listing(["me", "example.com"]),
      "example.org": listing(["me", "example.com"], ["other", "example.org"]),
    }
    const { apple, listLogins } = providerListing(
      (host) => listings[host] ?? listing(),
    )
    const logins = await apple.logins(
      "apple",
      new URL("https://accounts.example.com/login"),
    )
    expect(listLogins.mock.calls.map(([host]) => host)).toEqual([
      "accounts.example.com",
      "example.org",
    ])
    expect(logins.map((login) => [login.username, login.host])).toEqual([
      ["me", "example.com"],
      ["other", "example.org"],
    ])
  })

  it("lists only the logins of a subdomain Apple's list shares, not its parent domain's", async () => {
    const listings: Record<string, SiteListing> = {
      "shop.univision.com": listing(
        ["shopper", "shop.univision.com"],
        ["viewer", "univision.com"],
      ),
    }
    const { apple } = providerListing((host) => listings[host] ?? listing())
    const logins = await apple.logins("apple", new URL("https://meh.com/"))
    expect(logins.map((login) => [login.username, login.host])).toEqual([
      ["shopper", "shop.univision.com"],
    ])
  })
})

describe("AppleProvider.save", () => {
  const url = new URL("https://example.com/")

  /** A helper whose listing turns from `before` into `after` once asked to save. */
  function saving(before: string[], after: string[]) {
    const listed = (usernames: string[]) =>
      listing(
        ...usernames.map((name): [string, string] => [name, "example.com"]),
      )
    let current = listed(before)
    const fake = providerListing(() => current, {
      canSaveAccountWithEmptyUserName: true,
    })
    fake.offerLogin.mockImplementation(async () => {
      current = listed(after)
    })
    return fake
  }

  async function saveOutcome(apple: AppleProvider, username: string) {
    vi.useFakeTimers()
    try {
      const outcome = apple
        .save("apple", { url, username, password: "pw" })
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
    const { apple, offerLogin } = saving(["someone"], ["someone"])
    expect(await saveOutcome(apple, "  ")).toBe("apple.saveUnconfirmed")
    expect(offerLogin).toHaveBeenCalledWith("example.com", "", "pw")
  })

  it("refuses a login without a password before asking the helper", async () => {
    const { apple, listLogins, offerLogin } = saving([], ["me"])
    await expect(
      apple.save("apple", { url, username: "me", password: "" }),
    ).rejects.toMatchObject({ code: "apple.emptyPassword" })
    expect(listLogins).not.toHaveBeenCalled()
    expect(offerLogin).not.toHaveBeenCalled()
  })

  it("reports a named login the listing lacks as not stored", async () => {
    const { apple } = saving(["someone"], ["someone"])
    expect(await saveOutcome(apple, "me")).toBe("apple.notSaved")
  })
})

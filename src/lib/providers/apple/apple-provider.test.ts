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

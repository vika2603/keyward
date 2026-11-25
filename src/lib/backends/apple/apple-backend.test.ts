import { describe, expect, it } from "vitest"
import { AppleBackend, passwordIn } from "./apple-backend"

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

describe("AppleBackend.canSave", () => {
  const apple = new AppleBackend()
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

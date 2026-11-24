import { describe, expect, it } from "vitest"
import { AppleBackend } from "./apple-backend"

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

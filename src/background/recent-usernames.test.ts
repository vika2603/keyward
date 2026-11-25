import { beforeEach, describe, expect, it } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import {
  forgetUsername,
  recallUsername,
  rememberUsername,
} from "./recent-usernames"

beforeEach(() => {
  fakeBrowser.reset()
})

describe("recent usernames", () => {
  it("keeps the usernames of two tabs that sign in at once", async () => {
    await Promise.all([
      rememberUsername(1, "example.com", "first"),
      rememberUsername(2, "example.com", "second"),
    ])
    expect(await recallUsername(1, "example.com")).toBe("first")
    expect(await recallUsername(2, "example.com")).toBe("second")
  })

  it("forgets a closed tab's username only", async () => {
    await rememberUsername(1, "example.com", "first")
    await rememberUsername(2, "example.com", "second")
    await forgetUsername(1)
    expect(await recallUsername(1, "example.com")).toBeNull()
    expect(await recallUsername(2, "example.com")).toBe("second")
  })
})

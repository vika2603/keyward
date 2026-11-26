import { describe, expect, it } from "vitest"
import { likelyBrowser, removalCommand, setupCommand } from "./setup-command"

const ID = "abcdefghijklmnopabcdefghijklmnop"

describe("setupCommand", () => {
  it("names no browser for Chrome, the script's default", () => {
    expect(setupCommand(ID, "chrome")).toMatch(
      /\| bash -s -- abcdefghijklmnopabcdefghijklmnop$/,
    )
  })

  it("names any other browser before the extension ID", () => {
    expect(setupCommand(ID, "dia")).toMatch(
      /\| bash -s -- --browser dia abcdefghijklmnopabcdefghijklmnop$/,
    )
    expect(removalCommand("dia")).toMatch(
      /\| bash -s -- --browser dia --uninstall$/,
    )
  })
})

describe("likelyBrowser", () => {
  it("tells Edge and Brave by their brands", () => {
    expect(likelyBrowser(["Chromium", "Microsoft Edge", "Not=A?Brand"])).toBe(
      "edge",
    )
    expect(likelyBrowser(["Brave", "Chromium", "Not_A Brand"])).toBe("brave")
  })

  it("takes Chrome when no brand of its own is reported", () => {
    expect(likelyBrowser(["Google Chrome", "Chromium", "Not_A Brand"])).toBe(
      "chrome",
    )
    expect(likelyBrowser([])).toBe("chrome")
  })
})

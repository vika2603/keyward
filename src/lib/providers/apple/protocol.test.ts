import { describe, expect, it } from "vitest"
import { isLoginEntry, isNeverSavedEntry } from "./protocol"

describe("isLoginEntry", () => {
  it("keeps listed logins, with or without a username", () => {
    expect(isLoginEntry({ USR: "someone", PWD: "Not Included" })).toBe(true)
    expect(isLoginEntry({ USR: "", PWD: "Not Included" })).toBe(true)
  })

  it("drops the entry for a site whose passwords are never saved", () => {
    expect(
      isLoginEntry({
        USR: "Passwords not saved",
        PWD: "Not Included",
      }),
    ).toBe(false)
  })
})

describe("isNeverSavedEntry", () => {
  it("recognizes the entry of a site never saved, whose words the helper joins by no-break spaces", () => {
    expect(isNeverSavedEntry({ USR: "Passwords\u00a0not\u00a0saved" })).toBe(
      true,
    )
    expect(isNeverSavedEntry({ USR: "someone" })).toBe(false)
    expect(isNeverSavedEntry({})).toBe(false)
  })
})

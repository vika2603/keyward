import { describe, expect, it } from "vitest"
import { isLoginEntry } from "./protocol"

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

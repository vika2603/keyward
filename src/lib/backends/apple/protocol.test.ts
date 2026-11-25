import { describe, expect, it } from "vitest"
import { isPasswordEntry } from "./protocol"

describe("isPasswordEntry", () => {
  it("keeps logins whose password the listing leaves out", () => {
    expect(isPasswordEntry({ USR: "someone", PWD: "Not Included" })).toBe(true)
    expect(isPasswordEntry({ USR: "", PWD: "Not Included" })).toBe(true)
  })

  it("drops logins without a password, such as passkey-only ones", () => {
    expect(isPasswordEntry({ USR: "someone" })).toBe(false)
    expect(isPasswordEntry({ USR: "someone", PWD: "" })).toBe(false)
  })

  it("drops the entry for a site whose passwords are never saved", () => {
    expect(
      isPasswordEntry({
        USR: "Passwords not saved",
        PWD: "Not Included",
      }),
    ).toBe(false)
  })
})

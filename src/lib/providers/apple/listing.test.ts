import { describe, expect, it } from "vitest"
import { passwordIn } from "./listing"

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

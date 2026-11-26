import { describe, expect, it } from "vitest"
import { ApiError, NetworkError } from "@/lib/providers/bitwarden/api"
import { WrongPasswordError } from "@/lib/providers/bitwarden/crypto"
import { errorCode } from "./error-code"

describe("errorCode", () => {
  it("reports a server that cannot be reached as a network failure", () => {
    const failedFetch = new TypeError("Failed to fetch")
    expect(
      errorCode(new NetworkError("unreachable", { cause: failedFetch })),
    ).toBe("network")
  })

  it("reports Bitwarden's refusals by what was refused", () => {
    expect(errorCode(new WrongPasswordError())).toBe("bitwarden.wrongPassword")
    expect(errorCode(new ApiError(401, null))).toBe("bitwarden.auth")
    expect(errorCode(new ApiError(400, { error: "invalid_grant" }))).toBe(
      "bitwarden.auth",
    )
    expect(errorCode(new ApiError(500, null))).toBe("bitwarden.api")
  })

  it("reports any other error, including a TypeError in Keyward's own code, as internal", () => {
    expect(
      errorCode(new TypeError("Cannot read properties of undefined")),
    ).toBe("internal")
    expect(errorCode(new Error("unexpected"))).toBe("internal")
  })
})

import { describe, expect, it } from "vitest"
import { NetworkError } from "@/lib/providers/bitwarden/api"
import { errorCode } from "./error-code"

describe("errorCode", () => {
  it("reports a server that cannot be reached as a network failure", () => {
    const failedFetch = new TypeError("Failed to fetch")
    expect(
      errorCode(new NetworkError("unreachable", { cause: failedFetch })),
    ).toBe("network")
  })

  it("reports any other error, including a TypeError in Keyward's own code, as internal", () => {
    expect(
      errorCode(new TypeError("Cannot read properties of undefined")),
    ).toBe("internal")
    expect(errorCode(new Error("unexpected"))).toBe("internal")
  })
})

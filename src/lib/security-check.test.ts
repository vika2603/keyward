import { afterEach, describe, expect, it, vi } from "vitest"
import {
  changePasswordUrlFor,
  checkPasswordBreach,
  evaluatePasswordStrength,
  isInsecureHttpUri,
} from "./security-check"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("security checks", () => {
  it("scores weak vs strong passwords locally and truncates inputs over 256 chars", () => {
    expect(evaluatePasswordStrength("password123").score).toBeLessThanOrEqual(1)
    expect(evaluatePasswordStrength("password123").level).toBe("weak")
    expect(
      evaluatePasswordStrength("k9#Tv!82qM$pL4@wX7zN").score,
    ).toBeGreaterThanOrEqual(3)
    // Huge password still evaluates quickly because it is truncated to 256 chars.
    const prefix256 =
      "k9#Tv!82qM$pL4@wX7zN3rF&5yH*1uJ^6iK(0oP)8aS-2dD_4fG+7hJ=9kL[1zX]3cV{5bN}7mQ;9wE:2rT,4yU.6iO/8pA~0sD!3fG@5hJ#7kL$9zX%1cV^3bN&5mQ*7wE(9rT)2yU-4iO_6pA+8sD=0fG[2hJ]4kL{6zX}8cV;0bN:3mQ,5wE.7rT/9yU~1iO!4pA@6sD#8fG$0hJ%2kL^4zX&6cV*8bN(0mQ)3wE-5rT_7yU+9iO=1pA[3sD]5fG{7hJ}"
    expect(prefix256.length).toBeGreaterThanOrEqual(256)
    const huge = `${prefix256}password1234567890`
    expect(evaluatePasswordStrength(huge).score).toBeGreaterThanOrEqual(3)
    expect(evaluatePasswordStrength(huge)).toEqual(
      evaluatePasswordStrength(prefix256.slice(0, 256)),
    )
  })

  it("checks HIBP with k-anonymity (5-char SHA-1 prefix + Add-Padding: true) and ignores padded 0 lines", async () => {
    // SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
    const fetchMock = vi.fn(async () => {
      return new Response(
        [
          "00000000000000000000000000000000000:0",
          "1E4C9B93F3F0682250B6CF8331B7EE68FD8:9545824",
          "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:0",
        ].join("\r\n"),
        { status: 200 },
      )
    })
    vi.stubGlobal("fetch", fetchMock)

    const count = await checkPasswordBreach("password")
    expect(count).toBe(9545824)
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.pwnedpasswords.com/range/5BAA6",
      expect.objectContaining({
        headers: { "Add-Padding": "true" },
      }),
    )

    // Unbreached password returns 0.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:0")),
    )
    expect(await checkPasswordBreach("k9#Tv!82qM$pL4@wX7zN")).toBe(0)
  })

  it("builds /.well-known/change-password URLs and flags non-local HTTP URIs", () => {
    expect(changePasswordUrlFor("github.com")).toBe(
      "https://github.com/.well-known/change-password",
    )
    expect(changePasswordUrlFor("")).toBeNull()
    expect(isInsecureHttpUri("http://example.com/login")).toBe(true)
    expect(isInsecureHttpUri("https://example.com/login")).toBe(false)
    expect(isInsecureHttpUri("http://localhost:3000/login")).toBe(false)
    expect(isInsecureHttpUri("http://127.0.0.1:8080/")).toBe(false)
  })
})

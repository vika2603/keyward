import { Secret } from "otpauth"
import { describe, expect, it } from "vitest"
import { oneTimeCode } from "./totp"

// RFC 6238 test secret "12345678901234567890" in base32.
const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"

describe("oneTimeCode", () => {
  it("matches the RFC 6238 SHA-1 test vectors for a bare secret", () => {
    expect(oneTimeCode(SECRET, 59_000).code).toBe("287082")
    expect(oneTimeCode(SECRET, 1_111_111_109_000).code).toBe("081804")
    expect(oneTimeCode(SECRET.toLowerCase(), 1_234_567_890_000).code).toBe(
      "005924",
    )
  })

  it("follows the digits and period of an otpauth URI", () => {
    const eight = `otpauth://totp/Example:me?secret=${SECRET}&digits=8&issuer=Example`
    expect(oneTimeCode(eight, 59_000).code).toBe("94287082")
    const minute = `otpauth://totp/Example:me?secret=${SECRET}&period=60`
    const result = oneTimeCode(minute, 61_000)
    expect(result.period).toBe(60)
    expect(result.expiresAt).toBe(120_000)
  })

  it("reports when a 30-second code expires", () => {
    expect(oneTimeCode(SECRET, 59_000).expiresAt).toBe(60_000)
  })

  it("spells Steam codes in Steam's alphabet", () => {
    const { code } = oneTimeCode(`steam://${SECRET}`, 59_000)
    expect(code).toMatch(/^[23456789BCDFGHJKMNPQRTVWXY]{5}$/)
  })

  it("refuses counter-based codes", () => {
    expect(() =>
      oneTimeCode(`otpauth://hotp/Example:me?secret=${SECRET}&counter=1`),
    ).toThrow()
  })

  it("reads otpauth URIs without a label, with spaces in the secret and other algorithms", () => {
    const spaced = SECRET.replace(/(.{4})/g, "$1%20")
    expect(oneTimeCode(`otpauth://totp/?secret=${spaced}`, 59_000).code).toBe(
      "287082",
    )
    // RFC 6238 seeds for SHA-256 and SHA-512, 32 and 64 ASCII digits long.
    const sha256 = Secret.fromUTF8("12345678901234567890123456789012").base32
    expect(
      oneTimeCode(
        `otpauth://totp/x?secret=${sha256}&algorithm=sha256&digits=8`,
        59_000,
      ).code,
    ).toBe("46119246")
    const sha512 = Secret.fromUTF8(
      "1234567890123456789012345678901234567890123456789012345678901234",
    ).base32
    expect(
      oneTimeCode(
        `otpauth://totp/x?secret=${sha512}&algorithm=SHA512&digits=8`,
        59_000,
      ).code,
    ).toBe("90693936")
  })

  it("falls back to the defaults for values it does not know", () => {
    const uri = `otpauth://totp/x?secret=${SECRET}&digits=0&period=-5&algorithm=MD5`
    const result = oneTimeCode(uri, 59_000)
    expect(result.code).toBe("287082")
    expect(result.period).toBe(30)
  })

  it("refuses a URI without a secret", () => {
    expect(() => oneTimeCode("otpauth://totp/Example:me?issuer=x")).toThrow()
  })
})

import { describe, expect, it } from "vitest"
import { iconHostsOf, isHostName, withScheme } from "./site"

describe("withScheme", () => {
  it("keeps an address that has a scheme and puts the given one before one that has none", () => {
    expect(withScheme("HTTPS://example.com/a", "http")).toBe(
      "HTTPS://example.com/a",
    )
    expect(withScheme("ftp://example.com", "https")).toBe("ftp://example.com")
    expect(withScheme("example.com/a", "http")).toBe("http://example.com/a")
    expect(withScheme("example.com:8443", "https")).toBe(
      "https://example.com:8443",
    )
  })
})

describe("isHostName", () => {
  it("accepts domains, punycode and IPv4 addresses", () => {
    for (const host of ["example.com", "xn--bcher-kva.de", "127.0.0.1", "lan"])
      expect(isHostName(host)).toBe(true)
  })

  it("refuses empty labels, other characters and IPv6 addresses", () => {
    for (const host of [
      "",
      "example.com.",
      ".example.com",
      "a..example.com",
      "ex_ample.com",
      "[::1]",
    ])
      expect(isHostName(host)).toBe(false)
  })
})

describe("iconHostsOf", () => {
  it("falls back from a bare domain to its www form", () => {
    expect(iconHostsOf("google.com")).toEqual(["google.com", "www.google.com"])
  })

  it("falls back from a subdomain to its registrable domain", () => {
    expect(iconHostsOf("accounts.google.com")).toEqual([
      "accounts.google.com",
      "google.com",
      "www.google.com",
    ])
  })

  it("keeps a www host first and does not repeat it", () => {
    expect(iconHostsOf("www.github.com")).toEqual([
      "www.github.com",
      "github.com",
    ])
  })

  it("looks up hosts without a registrable domain only as they are", () => {
    expect(iconHostsOf("192.168.1.10")).toEqual(["192.168.1.10"])
    expect(iconHostsOf("localhost")).toEqual(["localhost"])
  })
})

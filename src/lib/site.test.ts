import { describe, expect, it } from "vitest"
import { iconHostsOf } from "./site"

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

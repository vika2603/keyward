import { describe, expect, it } from "vitest"
import { ruleForHost, uriMatches } from "./matching"
import { MatchType, type SiteRule } from "./settings"

const page = new URL("https://accounts.example.co.uk:8443/login?next=/home")
const options = {
  defaultMatch: MatchType.Domain,
  equivalentDomains: [] as string[][],
}

describe("uriMatches", () => {
  it("matches the registrable domain by default, including other subdomains", () => {
    expect(uriMatches("https://www.example.co.uk", null, page, options)).toBe(
      true,
    )
    expect(uriMatches("example.co.uk", null, page, options)).toBe(true)
    expect(uriMatches("https://example.com", null, page, options)).toBe(false)
    expect(uriMatches("https://other.co.uk", null, page, options)).toBe(false)
  })

  it("does not take a host that only ends with the domain as the same site", () => {
    const evil = new URL("https://example.co.uk.attacker.net/")
    expect(uriMatches("https://example.co.uk", null, evil, options)).toBe(false)
  })

  it("treats equivalent domains as one site", () => {
    const grouped = {
      ...options,
      equivalentDomains: [["example.co.uk", "example.org"]],
    }
    expect(uriMatches("https://example.org", null, page, grouped)).toBe(true)
    expect(uriMatches("https://example.net", null, page, grouped)).toBe(false)
  })

  it("compares host and port for a host match", () => {
    expect(
      uriMatches(
        "https://accounts.example.co.uk:8443",
        MatchType.Host,
        page,
        options,
      ),
    ).toBe(true)
    expect(
      uriMatches(
        "https://accounts.example.co.uk",
        MatchType.Host,
        page,
        options,
      ),
    ).toBe(false)
    expect(
      uriMatches(
        "https://www.example.co.uk:8443",
        MatchType.Host,
        page,
        options,
      ),
    ).toBe(false)
  })

  it("supports starts-with, exact, regular expression and never", () => {
    expect(
      uriMatches(
        "https://accounts.example.co.uk:8443/log",
        MatchType.StartsWith,
        page,
        options,
      ),
    ).toBe(true)
    expect(uriMatches(page.href, MatchType.Exact, page, options)).toBe(true)
    expect(
      uriMatches(
        "https://accounts.example.co.uk:8443/login",
        MatchType.Exact,
        page,
        options,
      ),
    ).toBe(false)
    expect(
      uriMatches(
        "^https://accounts\\.",
        MatchType.RegularExpression,
        page,
        options,
      ),
    ).toBe(true)
    expect(uriMatches("(", MatchType.RegularExpression, page, options)).toBe(
      false,
    )
    expect(uriMatches(page.href, MatchType.Never, page, options)).toBe(false)
  })

  it("does not offer an https login to an http page", () => {
    const http = new URL("http://accounts.example.co.uk/login")
    expect(uriMatches("https://example.co.uk", null, http, options)).toBe(false)
    expect(uriMatches("example.co.uk", null, http, options)).toBe(true)
  })

  it("uses the default match type when the entry has none", () => {
    const hostDefault = { ...options, defaultMatch: MatchType.Host }
    expect(
      uriMatches("https://www.example.co.uk", null, page, hostDefault),
    ).toBe(false)
  })
})

describe("ruleForHost", () => {
  const rule = (host: string): SiteRule => ({
    id: host,
    host,
    match: null,
    provider: "all",
    behavior: "default",
  })

  it("picks the most specific rule that covers the host", () => {
    const rules = [rule("example.com"), rule("login.example.com")]
    expect(ruleForHost(rules, "login.example.com")?.host).toBe(
      "login.example.com",
    )
    expect(ruleForHost(rules, "www.example.com")?.host).toBe("example.com")
    expect(ruleForHost(rules, "example.org")).toBeNull()
    expect(ruleForHost(rules, "notexample.com")).toBeNull()
  })
})

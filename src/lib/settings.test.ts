import { beforeEach, describe, expect, it } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { getSettings, MatchType, upgradeSiteRule } from "./settings"

beforeEach(() => fakeBrowser.reset())

describe("site rules saved by earlier versions", () => {
  const oldRule = {
    id: "r1",
    host: "example.com",
    match: MatchType.Host,
    backend: "bitwarden",
    behavior: "default",
  }

  it("reads their backend field as the provider", async () => {
    await fakeBrowser.storage.local.set({ settings: { siteRules: [oldRule] } })
    const [rule] = (await getSettings()).siteRules
    expect(rule).toMatchObject({ host: "example.com", provider: "bitwarden" })
    expect(rule).not.toHaveProperty("backend")
  })

  it("leaves current rules and other values as they are", () => {
    const rule = { ...oldRule, backend: undefined, provider: "apple" }
    expect(upgradeSiteRule(rule)).toBe(rule)
    expect(upgradeSiteRule(null)).toBeNull()
  })
})

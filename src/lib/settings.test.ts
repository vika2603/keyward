import { beforeEach, describe, expect, it } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import {
  defaultSettings,
  getSettings,
  importedSettings,
  MatchType,
  type Settings,
  type SiteRule,
  settingsFile,
  upgradeSiteRule,
} from "./settings"

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

describe("a settings file", () => {
  const rule: SiteRule = {
    id: "rule-1",
    host: "example.com",
    match: MatchType.Exact,
    provider: "bitwarden",
    behavior: "noSave",
  }
  /** Every exported setting with a value other than its default, so a dropped one shows. */
  const changed: Settings = {
    ...defaultSettings,
    menuTrigger: "click",
    crossOriginFrames: true,
    autoSubmit: true,
    askSave: false,
    askUpdate: false,
    takeOverSaving: false,
    takeOverPasskeys: false,
    contextMenu: false,
    clipboardClearSeconds: 120,
    defaultMatch: MatchType.Host,
    siteRules: [rule],
    equivalentDomains: [["example.com", "example.org"]],
  }
  const read = (file: unknown) =>
    importedSettings(JSON.parse(JSON.stringify(file)))

  it("brings back every setting the export wrote", () => {
    const file = settingsFile(changed)
    expect(read(file)).toEqual(file.settings)
    expect(file.settings).toMatchObject({
      takeOverSaving: false,
      takeOverPasskeys: false,
      contextMenu: false,
    })
  })

  it("leaves out values the settings could not hold", () => {
    const file = settingsFile(changed)
    const imported = read({
      ...file,
      settings: {
        ...file.settings,
        menuTrigger: "hover",
        askSave: "false",
        clipboardClearSeconds: 45,
        defaultMatch: 9,
        siteRules: [
          rule,
          { ...rule, id: "rule-2", host: "https://a.example/" },
          { ...rule, id: "rule-3", provider: "lastpass" },
          { ...rule, id: "rule-4", behavior: "autofill" },
        ],
        equivalentDomains: [["example.com"], ["a.example", "B.example"]],
      },
    })
    expect(imported).not.toHaveProperty("menuTrigger")
    expect(imported).not.toHaveProperty("askSave")
    expect(imported).not.toHaveProperty("clipboardClearSeconds")
    expect(imported).not.toHaveProperty("defaultMatch")
    expect(imported?.siteRules).toEqual([rule])
    expect(imported?.equivalentDomains).toEqual([])
  })

  it("takes the rules an earlier version wrote", () => {
    const { provider, ...rest } = rule
    const imported = read({
      format: "keyward-settings",
      settings: { siteRules: [{ ...rest, backend: provider }] },
    })
    expect(imported).toEqual({ siteRules: [rule] })
  })

  it("is refused when it is some other file", () => {
    expect(read({ format: "other", settings: changed })).toBeNull()
    expect(read({ format: "keyward-settings" })).toBeNull()
    expect(read([])).toBeNull()
  })
})

import { describe, expect, it } from "vitest"
import { type ExportedSettings, MatchType } from "@/lib/settings"
import { importedSettings } from "./keys-page"

/** Every exported setting with a value other than its default, so a dropped one shows. */
const exported = {
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
  siteRules: [
    {
      id: "rule-1",
      host: "example.com",
      match: MatchType.Exact,
      provider: "bitwarden",
      behavior: "noSave",
    },
  ],
  equivalentDomains: [["example.com", "example.org"]],
} satisfies ExportedSettings

describe("importing a settings file", () => {
  it("restores every setting the export wrote", () => {
    const file = { format: "keyward-settings", settings: exported }
    expect(importedSettings(JSON.parse(JSON.stringify(file)))).toEqual(exported)
  })
})

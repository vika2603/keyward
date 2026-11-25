import { afterEach, describe, expect, it } from "vitest"
import { resolveLanguage, setLanguage, t } from "."
import * as common from "./messages/common"
import * as options from "./messages/options"
import * as overlays from "./messages/overlays"
import * as popup from "./messages/popup"

const placeholders = (text: string) =>
  [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

afterEach(() => setLanguage("en"))

describe("catalogs", () => {
  it("give every key text in both languages, with the same placeholders", () => {
    for (const catalog of [common, popup, overlays, options]) {
      for (const [key, english] of Object.entries(catalog.en)) {
        const chinese = (catalog.zhCN as Record<string, string>)[key]
        expect(english, key).toBeTruthy()
        expect(chinese, key).toBeTruthy()
        expect(placeholders(chinese as string), key).toEqual(
          placeholders(english),
        )
      }
    }
  })
})

describe("t", () => {
  it("fills placeholders in the current language", () => {
    setLanguage("zh-CN")
    expect(t("popup.main.noLogins", { host: "github.com" })).toBe(
      "没有 github.com 的密码",
    )
    setLanguage("en")
    expect(t("popup.main.noLogins", { host: "github.com" })).toBe(
      "No passwords for github.com",
    )
  })
})

describe("resolveLanguage", () => {
  it("keeps an explicit choice", () => {
    expect(resolveLanguage("zh-CN")).toBe("zh-CN")
    expect(resolveLanguage("en")).toBe("en")
  })
})

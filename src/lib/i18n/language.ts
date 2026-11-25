import type { Settings } from "@/lib/settings"

export type Language = "zh-CN" | "en"

function browserLanguage(): string {
  try {
    return browser.i18n.getUILanguage()
  } catch {
    // Test doubles of the extension API leave i18n out.
    return navigator.language
  }
}

/** The language a setting stands for; "system" follows the browser's interface language. */
export function resolveLanguage(setting: Settings["language"]): Language {
  if (setting !== "system") return setting
  return browserLanguage().toLowerCase().startsWith("zh") ? "zh-CN" : "en"
}

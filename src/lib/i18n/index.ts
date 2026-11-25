import { type Language, resolveLanguage } from "./language"
import * as common from "./messages/common"
import * as options from "./messages/options"
import * as overlays from "./messages/overlays"
import * as popup from "./messages/popup"

const catalogs = {
  en: { ...common.en, ...popup.en, ...overlays.en, ...options.en },
  "zh-CN": {
    ...common.zhCN,
    ...popup.zhCN,
    ...overlays.zhCN,
    ...options.zhCN,
  },
}

export { type Language, resolveLanguage }

export type MessageKey = keyof typeof catalogs.en

let current: Language = resolveLanguage("system")

export function currentLanguage(): Language {
  return current
}

export function setLanguage(language: Language): void {
  current = language
}

/** The text for a key in the current language, with `{name}` placeholders filled from `params`. */
export function t(
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  const text: string = catalogs[current][key]
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  )
}

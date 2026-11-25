import { storage } from "wxt/utils/storage"

/** How an entry's saved web address is compared with the page. Values follow Bitwarden's URI match types. */
export const MatchType = {
  Domain: 0,
  Host: 1,
  StartsWith: 2,
  Exact: 3,
  RegularExpression: 4,
  Never: 5,
} as const
export type MatchType = (typeof MatchType)[keyof typeof MatchType]

export type SiteBehavior =
  | "default"
  | "menuOnFocus"
  | "menuOnClick"
  | "noSave"
  | "disabled"

export type RuleBackend = "all" | "apple" | "bitwarden"

export interface SiteRule {
  id: string
  /** A host name; the rule also covers its subdomains. */
  host: string
  /** Overrides the default match type for Bitwarden entries; null keeps the default. */
  match: MatchType | null
  backend: RuleBackend
  behavior: SiteBehavior
}

export interface Settings {
  appleEnabled: boolean
  menuTrigger: "click" | "focus"
  crossOriginFrames: boolean
  autoSubmit: boolean
  askSave: boolean
  askUpdate: boolean
  /** Whether the browser's own offer to save passwords is turned off while Keyward asks instead. */
  takeOverSaving: boolean
  /** Seconds after copying a password before the clipboard is overwritten; null never. */
  clipboardClearSeconds: number | null
  defaultMatch: MatchType
  /** Source ID new logins are saved to by default; null picks the first available one. */
  defaultSaveTarget: string | null
  /** Minutes without use before Bitwarden accounts lock; null only when the browser quits. */
  autoLockMinutes: number | null
  theme: "system" | "light" | "dark"
  density: "standard" | "compact"
  /** Interface language; "system" follows the browser. */
  language: "system" | "zh-CN" | "en"
  siteRules: SiteRule[]
  equivalentDomains: string[][]
}

export const defaultSettings: Settings = {
  appleEnabled: false,
  menuTrigger: "focus",
  crossOriginFrames: false,
  autoSubmit: false,
  askSave: true,
  askUpdate: true,
  takeOverSaving: false,
  clipboardClearSeconds: 30,
  defaultMatch: MatchType.Domain,
  defaultSaveTarget: null,
  autoLockMinutes: 15,
  theme: "system",
  density: "standard",
  language: "system",
  siteRules: [],
  equivalentDomains: [],
}

export const settingsItem = storage.defineItem<Settings>("local:settings", {
  fallback: defaultSettings,
})

export async function getSettings(): Promise<Settings> {
  return { ...defaultSettings, ...(await settingsItem.getValue()) }
}

export async function updateSettings(
  patch: Partial<Settings>,
): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch }
  await settingsItem.setValue(next)
  return next
}

/** The parts of the settings that a configuration export carries. */
export const exportableKeys = [
  "menuTrigger",
  "crossOriginFrames",
  "autoSubmit",
  "askSave",
  "askUpdate",
  "takeOverSaving",
  "clipboardClearSeconds",
  "defaultMatch",
  "siteRules",
  "equivalentDomains",
] as const satisfies readonly (keyof Settings)[]

export type ExportedSettings = Pick<Settings, (typeof exportableKeys)[number]>

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

export type RuleProvider = "all" | "apple" | "bitwarden"

export interface SiteRule {
  id: string
  /** A host name; the rule also covers its subdomains. */
  host: string
  /** Overrides the default match type for Bitwarden entries; null keeps the default. */
  match: MatchType | null
  provider: RuleProvider
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
  /** Whether a page's passkey sign-in is offered in Keyward's menu instead of the browser's list. */
  takeOverPasskeys: boolean
  /** Whether the browser's context menu fills and copies the page's logins. */
  contextMenu: boolean
  /** Seconds after copying a password before the clipboard is overwritten; null never. */
  clipboardClearSeconds: number | null
  defaultMatch: MatchType
  /** Vault ID new logins are saved to by default; null picks the first available one. */
  defaultSaveTarget: string | null
  /** Minutes without use before Bitwarden accounts lock; null only when the browser quits. */
  autoLockMinutes: number | null
  /** Whether Bitwarden accounts lock when the computer's screen locks. */
  lockOnSystemLock: boolean
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
  takeOverSaving: true,
  takeOverPasskeys: true,
  contextMenu: true,
  clipboardClearSeconds: 30,
  defaultMatch: MatchType.Domain,
  defaultSaveTarget: null,
  autoLockMinutes: 15,
  lockOnSystemLock: true,
  theme: "system",
  density: "standard",
  language: "system",
  siteRules: [],
  equivalentDomains: [],
}

export const settingsItem = storage.defineItem<Settings>("local:settings", {
  fallback: defaultSettings,
})

/** Rules saved or exported by earlier versions name the `provider` field `backend`. */
export function upgradeSiteRule(rule: unknown): unknown {
  const isOldRule =
    typeof rule === "object" &&
    rule !== null &&
    "backend" in rule &&
    !("provider" in rule)
  if (!isOldRule) return rule

  const { backend, ...rest } = rule
  return { ...rest, provider: backend }
}

export async function getSettings(): Promise<Settings> {
  const saved = await settingsItem.getValue()
  const siteRules = (saved.siteRules ?? []).map(upgradeSiteRule) as SiteRule[]
  return { ...defaultSettings, ...saved, siteRules }
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
  "takeOverPasskeys",
  "contextMenu",
  "clipboardClearSeconds",
  "defaultMatch",
  "siteRules",
  "equivalentDomains",
] as const satisfies readonly (keyof Settings)[]

export type ExportedSettings = Pick<Settings, (typeof exportableKeys)[number]>

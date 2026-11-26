import { storage } from "wxt/utils/storage"
import { hostOfSavedUri } from "./site"

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

export const SITE_BEHAVIORS = [
  "default",
  "menuOnFocus",
  "menuOnClick",
  "menuOff",
  "noSave",
  "disabled",
] as const
export type SiteBehavior = (typeof SITE_BEHAVIORS)[number]

export const RULE_PROVIDERS = ["all", "apple", "bitwarden"] as const
export type RuleProvider = (typeof RULE_PROVIDERS)[number]

/**
 * When the in-page menu opens: on a field's focus, on a click on its icon, or never, which leaves
 * the fields without the icon and filling to the toolbar button, the shortcut and the context menu.
 */
export const MENU_TRIGGERS = ["click", "focus", "off"] as const
export type MenuTrigger = (typeof MENU_TRIGGERS)[number]

/** The delays the settings offer for clearing a copied password, in seconds. */
export const CLIPBOARD_CLEAR_SECONDS = [30, 60, 120, 300] as const
export type ClipboardClearSeconds = (typeof CLIPBOARD_CLEAR_SECONDS)[number]

/** The idle times the settings offer before Bitwarden accounts lock, in minutes. */
export const AUTO_LOCK_MINUTES = [1, 5, 15, 30, 60, 240] as const
export type AutoLockMinutes = (typeof AUTO_LOCK_MINUTES)[number]

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
  menuTrigger: MenuTrigger
  /**
   * Whether login fields in frames from a site other than the page's get the icon and fills;
   * frames of the page's own site always do.
   */
  crossSiteFrames: boolean
  autoSubmit: boolean
  askSave: boolean
  askUpdate: boolean
  /** Whether the browser's own offer to save passwords is turned off while Keyward asks instead. */
  takeOverSaving: boolean
  /** Whether a page's passkey sign-in is offered in Keyward's menu instead of the browser's list. */
  takeOverPasskeys: boolean
  /** Whether the browser's context menu fills and copies the page's logins. */
  contextMenu: boolean
  /**
   * Whether a site that asks for a login through the browser's own sign-in dialog gets the popup
   * with its logins first.
   */
  httpAuth: boolean
  /** Seconds after copying a password before the clipboard is overwritten; null never. */
  clipboardClearSeconds: ClipboardClearSeconds | null
  defaultMatch: MatchType
  /** Vault ID new logins are saved to by default; null picks the first available one. */
  defaultSaveTarget: string | null
  /** Minutes without use before Bitwarden accounts lock; null only when the browser quits. */
  autoLockMinutes: AutoLockMinutes | null
  /** Whether Bitwarden accounts lock when the computer's screen locks. */
  lockOnSystemLock: boolean
  /** Whether the toolbar button shows how many logins the active tab's page has. */
  loginCountBadge: boolean
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
  crossSiteFrames: true,
  autoSubmit: false,
  askSave: true,
  askUpdate: true,
  takeOverSaving: true,
  takeOverPasskeys: true,
  contextMenu: true,
  httpAuth: true,
  clipboardClearSeconds: 30,
  defaultMatch: MatchType.Domain,
  defaultSaveTarget: null,
  autoLockMinutes: 15,
  lockOnSystemLock: true,
  loginCountBadge: true,
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
  "crossSiteFrames",
  "autoSubmit",
  "askSave",
  "askUpdate",
  "takeOverSaving",
  "takeOverPasskeys",
  "contextMenu",
  "httpAuth",
  "clipboardClearSeconds",
  "defaultMatch",
  "siteRules",
  "equivalentDomains",
] as const satisfies readonly (keyof Settings)[]

type ExportableKey = (typeof exportableKeys)[number]

export type ExportedSettings = Pick<Settings, ExportableKey>

const SETTINGS_FILE_FORMAT = "keyward-settings"

/** The contents of a settings file for the given settings. */
export function settingsFile(settings: Settings): {
  format: string
  settings: ExportedSettings
} {
  return {
    format: SETTINGS_FILE_FORMAT,
    settings: Object.fromEntries(
      exportableKeys.map((key) => [key, settings[key]]),
    ) as ExportedSettings,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function oneOf<T>(values: readonly T[]) {
  return (value: unknown): value is T => values.includes(value as T)
}

const isMatchType = oneOf(Object.values(MatchType))

/** A rule from a file is taken only when every field has a value the options page could have set. */
function isSiteRule(value: unknown): value is SiteRule {
  if (!isRecord(value)) return false
  return (
    typeof value.id === "string" &&
    typeof value.host === "string" &&
    hostOfSavedUri(value.host) === value.host &&
    (value.match === null || isMatchType(value.match)) &&
    oneOf(RULE_PROVIDERS)(value.provider) &&
    oneOf(SITE_BEHAVIORS)(value.behavior)
  )
}

function isDomainGroup(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.every(
      (domain) =>
        typeof domain === "string" && hostOfSavedUri(domain) === domain,
    )
  )
}

/**
 * How a settings file's value for each exported setting is read: the value when it is one the
 * settings could hold, cleaned where needed, and undefined otherwise. Every exported setting
 * needs one, so an import cannot leave out what an export writes.
 */
const importers: {
  [K in ExportableKey]: (value: unknown) => ExportedSettings[K] | undefined
} = {
  menuTrigger: (value) => (oneOf(MENU_TRIGGERS)(value) ? value : undefined),
  crossSiteFrames: importBoolean,
  autoSubmit: importBoolean,
  askSave: importBoolean,
  askUpdate: importBoolean,
  takeOverSaving: importBoolean,
  takeOverPasskeys: importBoolean,
  contextMenu: importBoolean,
  httpAuth: importBoolean,
  clipboardClearSeconds: (value) =>
    value === null || oneOf(CLIPBOARD_CLEAR_SECONDS)(value) ? value : undefined,
  defaultMatch: (value) => (isMatchType(value) ? value : undefined),
  siteRules: (value) =>
    Array.isArray(value)
      ? value.map(upgradeSiteRule).filter(isSiteRule)
      : undefined,
  equivalentDomains: (value) =>
    Array.isArray(value) ? value.filter(isDomainGroup) : undefined,
}

function importBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function importSetting<K extends ExportableKey>(
  key: K,
  input: Record<string, unknown>,
  result: Partial<ExportedSettings>,
): void {
  const value = importers[key](input[key])
  if (value !== undefined) result[key] = value
}

/** The settings a settings file holds, each kept only with a value the settings could hold; null for another file. */
export function importedSettings(
  data: unknown,
): Partial<ExportedSettings> | null {
  if (!isRecord(data) || data.format !== SETTINGS_FILE_FORMAT) return null
  const importedData = data.settings
  if (!isRecord(importedData)) return null
  const result: Partial<ExportedSettings> = {}
  for (const key of exportableKeys) importSetting(key, importedData, result)
  return result
}

import { ExternalLinkIcon } from "lucide-react"
import { type ChangeEvent, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { type MessageKey, t } from "@/lib/i18n"
import {
  type ExportedSettings,
  exportableKeys,
  getSettings,
  MatchType,
  type SiteRule,
  updateSettings,
} from "@/lib/settings"
import { hostOfSavedUri } from "@/lib/site"
import { clearTimes } from "./fill-page"
import { Card, Option, PageHeader, Section, Segmented } from "./parts"
import { useSettings } from "./use-settings"

function commandNames(): [string, string][] {
  return [
    ["_execute_action", t("options.keys.command.openPopup")],
    ["fill-first", t("options.keys.command.fillFirst")],
    ["open-generator", t("options.keys.command.openGenerator")],
    ["lock-all", t("options.keys.command.lockAll")],
  ]
}

const EXPORT_FORMAT = "keyward-settings"

/** macOS reports modifiers as symbols; they are shown by name, as on other systems. */
const MODIFIER_NAMES: Record<string, string> = {
  "⌃": "Ctrl",
  "⇧": "Shift",
  "⌥": "Option",
  "⌘": "Command",
}

/** Splits a shortcut such as "Ctrl+Shift+U" or "⌃⇧U" into its keys. */
function keysOf(shortcut: string): string[] {
  if (shortcut.includes("+")) return shortcut.split("+")
  return [...shortcut].map((key) => MODIFIER_NAMES[key] ?? key)
}

const RULE_BACKENDS: readonly unknown[] = ["all", "apple", "bitwarden"]
const RULE_BEHAVIORS: readonly unknown[] = [
  "default",
  "menuOnFocus",
  "menuOnClick",
  "noSave",
  "disabled",
]

/** A rule from a file is taken only when every field has a value the options page could have set. */
function isSiteRule(value: unknown): value is SiteRule {
  if (!value || typeof value !== "object") return false
  const rule = value as Record<string, unknown>
  return (
    typeof rule.id === "string" &&
    typeof rule.host === "string" &&
    hostOfSavedUri(rule.host) === rule.host &&
    (rule.match === null ||
      Object.values(MatchType).includes(rule.match as MatchType)) &&
    RULE_BACKENDS.includes(rule.backend) &&
    RULE_BEHAVIORS.includes(rule.behavior)
  )
}

/** Keeps the known settings whose values have the expected type. */
function importedSettings(data: unknown): Partial<ExportedSettings> | null {
  if (
    !data ||
    typeof data !== "object" ||
    (data as { format?: unknown }).format !== EXPORT_FORMAT
  )
    return null
  const source = (data as { settings?: unknown }).settings
  if (!source || typeof source !== "object") return null
  const input = source as Record<string, unknown>
  const result: Partial<ExportedSettings> = {}
  if (input.menuTrigger === "click" || input.menuTrigger === "focus")
    result.menuTrigger = input.menuTrigger
  for (const key of [
    "crossOriginFrames",
    "autoSubmit",
    "askSave",
    "askUpdate",
  ] as const) {
    if (typeof input[key] === "boolean") result[key] = input[key]
  }
  const clearAfter = input.clipboardClearSeconds
  if (
    clearAfter === null ||
    (typeof clearAfter === "number" &&
      clearTimes().some(([value]) => value === String(clearAfter)))
  ) {
    result.clipboardClearSeconds = clearAfter
  }
  if (Object.values(MatchType).includes(input.defaultMatch as MatchType)) {
    result.defaultMatch = input.defaultMatch as MatchType
  }
  if (Array.isArray(input.siteRules)) {
    result.siteRules = input.siteRules.filter(isSiteRule)
  }
  if (Array.isArray(input.equivalentDomains)) {
    result.equivalentDomains = input.equivalentDomains.filter(
      (g): g is string[] =>
        Array.isArray(g) &&
        g.length >= 2 &&
        g.every((d) => typeof d === "string" && hostOfSavedUri(d) === d),
    )
  }
  return result
}

export function KeysPage() {
  const [settings, update] = useSettings()
  const [commands, setCommands] = useState<Browser.commands.Command[]>([])
  const [message, setMessage] = useState<MessageKey | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void browser.commands.getAll().then(setCommands)
  }, [])

  if (!settings) return null

  const exportSettings = async () => {
    const current = await getSettings()
    const data = {
      format: EXPORT_FORMAT,
      settings: Object.fromEntries(
        exportableKeys.map((key) => [key, current[key]]),
      ),
    }
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    )
    const link = document.createElement("a")
    link.href = url
    link.download = "keyward-settings.json"
    link.click()
    URL.revokeObjectURL(url)
  }

  const importSettings = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    try {
      const imported = importedSettings(JSON.parse(await file.text()))
      if (!imported) throw new Error("not a Keyward settings file")
      await updateSettings(imported)
      setMessage("options.keys.import.done")
    } catch {
      setMessage("options.keys.import.failed")
    }
  }

  return (
    <>
      <PageHeader title={t("options.keys.title")} />
      <Section
        title={t("options.keys.shortcuts.title")}
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void browser.tabs.create({ url: "chrome://extensions/shortcuts" })
            }
          >
            <ExternalLinkIcon />
            {t("options.keys.shortcuts.change")}
          </Button>
        }
      >
        <p className="text-sm text-muted-foreground">
          {t("options.keys.shortcuts.description")}
        </p>
        <Card>
          {commandNames().map(([name, title]) => {
            const shortcut = commands.find((c) => c.name === name)?.shortcut
            return (
              <Option key={name} name={title}>
                {shortcut ? (
                  <KbdGroup>
                    {keysOf(shortcut).map((key, index) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: keys of one shortcut keep their order.
                      <Kbd key={index}>{key}</Kbd>
                    ))}
                  </KbdGroup>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    {t("options.keys.shortcuts.notSet")}
                  </span>
                )}
              </Option>
            )
          })}
        </Card>
      </Section>
      <Section title={t("options.keys.appearance.title")}>
        <Card>
          <Option name={t("options.keys.theme.name")}>
            <Segmented
              label={t("options.keys.theme.name")}
              value={settings.theme}
              options={[
                ["system", t("options.keys.theme.system")],
                ["light", t("options.keys.theme.light")],
                ["dark", t("options.keys.theme.dark")],
              ]}
              onChange={(theme) => update({ theme })}
            />
          </Option>
          <Option
            name={t("options.keys.density.name")}
            description={t("options.keys.density.description")}
          >
            <Segmented
              label={t("options.keys.density.name")}
              value={settings.density}
              options={[
                ["standard", t("options.keys.density.standard")],
                ["compact", t("options.keys.density.compact")],
              ]}
              onChange={(density) => update({ density })}
            />
          </Option>
          <Option name={t("options.keys.language.name")}>
            <Segmented
              label={t("options.keys.language.name")}
              value={settings.language}
              options={[
                ["system", t("options.keys.language.system")],
                ["zh-CN", t("options.keys.language.zhCN")],
                ["en", t("options.keys.language.en")],
              ]}
              onChange={(language) => update({ language })}
            />
          </Option>
        </Card>
      </Section>
      <Section title={t("options.keys.file.title")}>
        <Card>
          <Option
            name={t("options.keys.export.name")}
            description={t("options.keys.export.description")}
          >
            <Button variant="outline" onClick={() => void exportSettings()}>
              {t("options.keys.export.button")}
            </Button>
          </Option>
          <Option
            name={t("options.keys.import.name")}
            description={t("options.keys.import.description")}
          >
            <Button
              variant="outline"
              onClick={() => fileInput.current?.click()}
            >
              {t("options.keys.import.button")}
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => void importSettings(event)}
            />
          </Option>
          {message && (
            <p className="px-4 pb-3 text-sm text-muted-foreground">
              {t(message)}
            </p>
          )}
        </Card>
      </Section>
    </>
  )
}

import { ExternalLinkIcon } from "lucide-react"
import { type ChangeEvent, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import {
  type ExportedSettings,
  exportableKeys,
  getSettings,
  MatchType,
  type SiteRule,
  updateSettings,
} from "@/lib/settings"
import { hostOfSavedUri } from "@/lib/site"
import { CLEAR_TIMES } from "./fill-page"
import { Card, Option, PageHeader, Section, Segmented } from "./parts"
import { useSettings } from "./use-settings"

const COMMAND_NAMES: [string, string][] = [
  ["_execute_action", "打开弹窗"],
  ["fill-first", "填充当前站点的第一个匹配"],
  ["open-generator", "打开密码生成器"],
  ["lock-all", "锁定全部后端"],
]

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
      CLEAR_TIMES.some(([value]) => value === String(clearAfter)))
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
  const [message, setMessage] = useState<string | null>(null)
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
      setMessage("已导入。")
    } catch {
      setMessage("无法导入：文件不是 Keyward 导出的配置。")
    }
  }

  return (
    <>
      <PageHeader title="快捷键与外观" />
      <Section
        title="快捷键"
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void browser.tabs.create({ url: "chrome://extensions/shortcuts" })
            }
          >
            <ExternalLinkIcon />
            在浏览器中修改
          </Button>
        }
      >
        <p className="text-sm text-muted-foreground">
          快捷键由浏览器管理，这里显示当前生效的按键。
        </p>
        <Card>
          {COMMAND_NAMES.map(([name, title]) => {
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
                  <span className="text-sm text-muted-foreground">未设置</span>
                )}
              </Option>
            )
          })}
        </Card>
      </Section>
      <Section title="外观">
        <Card>
          <Option name="主题">
            <Segmented
              label="主题"
              value={settings.theme}
              options={[
                ["system", "跟随系统"],
                ["light", "浅色"],
                ["dark", "深色"],
              ]}
              onChange={(theme) => update({ theme })}
            />
          </Option>
          <Option
            name="列表密度"
            description="紧凑时账号名和站点（Bitwarden 为条目名称）显示在同一行，一屏能放更多条目。"
          >
            <Segmented
              label="列表密度"
              value={settings.density}
              options={[
                ["standard", "标准"],
                ["compact", "紧凑"],
              ]}
              onChange={(density) => update({ density })}
            />
          </Option>
        </Card>
      </Section>
      <Section title="配置文件">
        <Card>
          <Option
            name="导出配置"
            description="站点规则和填充选项，导出为 JSON 文件。不包含任何密码。"
          >
            <Button variant="outline" onClick={() => void exportSettings()}>
              导出
            </Button>
          </Option>
          <Option
            name="导入配置"
            description="导入会覆盖当前的站点规则和填充选项。"
          >
            <Button
              variant="outline"
              onClick={() => fileInput.current?.click()}
            >
              选择文件
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
            <p className="px-4 pb-3 text-sm text-muted-foreground">{message}</p>
          )}
        </Card>
      </Section>
    </>
  )
}

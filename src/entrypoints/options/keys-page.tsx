import { ExternalLinkIcon } from "lucide-react"
import { type ChangeEvent, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { Switch } from "@/components/ui/switch"
import { useSettings } from "@/hooks/use-settings"
import { type MessageKey, t } from "@/lib/i18n"
import {
  getSettings,
  importedSettings,
  settingsFile,
  updateSettings,
} from "@/lib/settings"
import { Card, Option, PageHeader, Section, Segmented } from "./parts"

function commandNames(): [string, string][] {
  return [
    ["_execute_action", t("options.keys.command.openPopup")],
    ["fill-first", t("options.keys.command.fillFirst")],
    ["open-generator", t("options.keys.command.openGenerator")],
    ["lock-all", t("options.keys.command.lockAll")],
  ]
}

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
    const data = settingsFile(await getSettings())
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
            const shortcut = commands.find(
              (command) => command.name === name,
            )?.shortcut
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
          <Option
            name={t("options.keys.loginCountBadge.name")}
            description={t("options.keys.loginCountBadge.description")}
          >
            <Switch
              aria-label={t("options.keys.loginCountBadge.name")}
              checked={settings.loginCountBadge}
              onCheckedChange={(checked) =>
                update({ loginCountBadge: checked })
              }
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

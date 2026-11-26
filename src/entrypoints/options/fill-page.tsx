import { useEffect, useState } from "react"
import { Switch } from "@/components/ui/switch"
import { useSettings } from "@/hooks/use-settings"
import {
  type BrowserSavingControl,
  browserSavingControl,
} from "@/lib/browser-saving"
import { t } from "@/lib/i18n"
import {
  CLIPBOARD_CLEAR_SECONDS,
  type ClipboardClearSeconds,
} from "@/lib/settings"
import {
  Card,
  ChoiceSelect,
  Option,
  PageHeader,
  Section,
  Segmented,
} from "./parts"

/** Who controls the browser's offer to save, read again when it may have changed. */
function useBrowserSavingControl(
  takeOver: boolean | undefined,
): BrowserSavingControl | null {
  const [control, setControl] = useState<BrowserSavingControl | null>(null)
  useEffect(() => {
    if (takeOver === undefined) return
    const read = () =>
      void browserSavingControl().then(setControl, () => setControl(null))
    read()
    browser.privacy?.services.passwordSavingEnabled.onChange.addListener(read)
    addEventListener("focus", read)
    return () => {
      browser.privacy?.services.passwordSavingEnabled.onChange.removeListener(
        read,
      )
      removeEventListener("focus", read)
    }
  }, [takeOver])
  return control
}

function clearTimes(): (readonly [ClipboardClearSeconds | "never", string])[] {
  const labels: Record<ClipboardClearSeconds, string> = {
    30: t("options.duration.seconds", { count: 30 }),
    60: t("options.duration.oneMinute"),
    120: t("options.duration.minutes", { count: 2 }),
    300: t("options.duration.minutes", { count: 5 }),
  }
  return [
    ...CLIPBOARD_CLEAR_SECONDS.map(
      (seconds) => [seconds, labels[seconds]] as const,
    ),
    ["never", t("options.fill.clipboardClear.never")],
  ]
}

export function FillPage() {
  const [settings, update] = useSettings()
  const control = useBrowserSavingControl(settings?.takeOverSaving)
  if (!settings) return null

  return (
    <>
      <PageHeader
        title={t("options.fill.title")}
        description={t("options.fill.description")}
      />
      <Section title={t("options.fill.menu.title")}>
        <Card>
          <Option
            name={t("options.fill.menuTrigger.name")}
            description={t("options.fill.menuTrigger.description")}
          >
            <Segmented
              label={t("options.fill.menuTrigger.name")}
              value={settings.menuTrigger}
              options={[
                ["click", t("options.fill.menuTrigger.click")],
                ["focus", t("options.fill.menuTrigger.focus")],
                ["off", t("options.fill.menuTrigger.off")],
              ]}
              onChange={(menuTrigger) => update({ menuTrigger })}
            />
          </Option>
          <Option
            name={t("options.fill.crossSiteFrames.name")}
            description={t("options.fill.crossSiteFrames.description")}
          >
            <Switch
              aria-label={t("options.fill.crossSiteFrames.name")}
              checked={settings.crossSiteFrames}
              onCheckedChange={(checked) =>
                update({ crossSiteFrames: checked })
              }
            />
          </Option>
          <Option
            name={t("options.fill.takeOverPasskeys.name")}
            description={t("options.fill.takeOverPasskeys.description")}
          >
            <Switch
              aria-label={t("options.fill.takeOverPasskeys.name")}
              checked={settings.takeOverPasskeys}
              onCheckedChange={(checked) =>
                update({ takeOverPasskeys: checked })
              }
            />
          </Option>
          <Option
            name={t("options.fill.httpAuth.name")}
            description={t("options.fill.httpAuth.description")}
          >
            <Switch
              aria-label={t("options.fill.httpAuth.name")}
              checked={settings.httpAuth}
              onCheckedChange={(checked) => update({ httpAuth: checked })}
            />
          </Option>
          <Option
            name={t("options.fill.contextMenu.name")}
            description={t("options.fill.contextMenu.description")}
          >
            <Switch
              aria-label={t("options.fill.contextMenu.name")}
              checked={settings.contextMenu}
              onCheckedChange={(checked) => update({ contextMenu: checked })}
            />
          </Option>
        </Card>
      </Section>
      <Section title={t("options.fill.autofill.title")}>
        <Card>
          <Option
            name={t("options.fill.autoSubmit.name")}
            description={t("options.fill.autoSubmit.description")}
          >
            <Switch
              aria-label={t("options.fill.autoSubmit.name")}
              checked={settings.autoSubmit}
              onCheckedChange={(checked) => update({ autoSubmit: checked })}
            />
          </Option>
        </Card>
      </Section>
      <Section title={t("options.fill.save.title")}>
        <Card>
          <Option
            name={t("options.fill.askSave.name")}
            description={t("options.fill.askSave.description")}
          >
            <Switch
              aria-label={t("options.fill.askSave.name")}
              checked={settings.askSave}
              onCheckedChange={(checked) => update({ askSave: checked })}
            />
          </Option>
          <Option
            name={t("options.fill.askUpdate.name")}
            description={t("options.fill.askUpdate.description")}
          >
            <Switch
              aria-label={t("options.fill.askUpdate.name")}
              checked={settings.askUpdate}
              onCheckedChange={(checked) => update({ askUpdate: checked })}
            />
          </Option>
          <Option
            name={t("options.fill.takeOverSaving.name")}
            description={
              <>
                {t("options.fill.takeOverSaving.description")}
                {settings.takeOverSaving &&
                  (control === "otherExtension" || control === "policy") && (
                    <span className="mt-1 block text-destructive">
                      {control === "otherExtension"
                        ? t("options.fill.takeOverSaving.otherExtension")
                        : t("options.fill.takeOverSaving.policy")}
                    </span>
                  )}
              </>
            }
          >
            <Switch
              aria-label={t("options.fill.takeOverSaving.name")}
              checked={settings.takeOverSaving}
              onCheckedChange={(checked) => update({ takeOverSaving: checked })}
            />
          </Option>
        </Card>
      </Section>
      <Section title={t("options.fill.clipboard.title")}>
        <Card>
          <Option
            name={t("options.fill.clipboardClear.name")}
            description={t("options.fill.clipboardClear.description")}
          >
            <ChoiceSelect
              names={clearTimes()}
              value={settings.clipboardClearSeconds ?? "never"}
              onChange={(seconds) =>
                update({
                  clipboardClearSeconds: seconds === "never" ? null : seconds,
                })
              }
              label={t("options.fill.clipboardClear.label")}
            />
          </Option>
        </Card>
      </Section>
    </>
  )
}

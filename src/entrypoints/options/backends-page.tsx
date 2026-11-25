import { ExternalLinkIcon, PlusIcon } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { callBackground } from "@/background/api"
import { BrandIcon, backendName } from "@/components/keyward/brand-icon"
import { errorMessage } from "@/components/keyward/errors"
import { SourceSelect } from "@/components/keyward/source-select"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { APPLE_SOURCE_ID } from "@/lib/backends/apple/source-id"
import type { AccountSummary } from "@/lib/backends/bitwarden/bitwarden-backend"
import type { SourceInfo } from "@/lib/backends/types"
import { t } from "@/lib/i18n"
import { navigate } from "./App"
import { Card, Option, PageHeader, Section } from "./parts"
import { useSettings } from "./use-settings"

function lockTimes(): [string, string][] {
  return [
    ["1", t("options.duration.oneMinute")],
    ["5", t("options.duration.minutes", { count: 5 })],
    ["15", t("options.duration.minutes", { count: 15 })],
    ["30", t("options.duration.minutes", { count: 30 })],
    ["60", t("options.duration.oneHour")],
    ["240", t("options.duration.hours", { count: 4 })],
    ["never", t("options.backends.autoLock.onQuit")],
  ]
}

export function BackendsPage() {
  const [settings, update] = useSettings()
  const [accounts, setAccounts] = useState<AccountSummary[]>([])
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(() => {
    void callBackground("bitwarden.accounts", null).then(setAccounts)
  }, [])
  useEffect(load, [load])

  if (!settings) return null

  const signOut = async (account: AccountSummary) => {
    if (
      !confirm(
        t("options.backends.bitwarden.signOutConfirm", {
          email: account.email,
        }),
      )
    )
      return
    await callBackground("bitwarden.signOut", { accountId: account.id })
    load()
  }

  const openApp = async () => {
    setMessage(null)
    try {
      await callBackground("apple.openPasswordsApp", null)
    } catch (error) {
      setMessage(errorMessage(error))
    }
  }

  const targets: SourceInfo[] = [
    ...(settings.appleEnabled
      ? [
          {
            id: APPLE_SOURCE_ID,
            kind: "apple" as const,
            label: backendName("apple"),
            status: "ready" as const,
          },
        ]
      : []),
    ...accounts.map((a) => ({
      id: a.sourceId,
      kind: "bitwarden" as const,
      label: a.email,
      status: "ready" as const,
    })),
  ]
  const defaultTarget =
    targets.find((target) => target.id === settings.defaultSaveTarget)?.id ??
    targets[0]?.id ??
    null

  return (
    <>
      <PageHeader
        title={t("options.backends.title")}
        description={t("options.backends.description")}
      />
      <Card>
        <Option
          name={
            <span className="flex items-center gap-2.5">
              <BrandIcon kind="apple" />
              {backendName("apple")}
            </span>
          }
          description={t("options.backends.apple.description")}
        >
          <Switch
            aria-label={t("options.backends.apple.toggle")}
            checked={settings.appleEnabled}
            onCheckedChange={(checked) => update({ appleEnabled: checked })}
          />
        </Option>
        {settings.appleEnabled && (
          <Option
            name={t("options.backends.apple.actions.name")}
            description={t("options.backends.apple.actions.description")}
          >
            <Button variant="outline" onClick={() => void openApp()}>
              <ExternalLinkIcon />
              {t("options.backends.apple.openApp")}
            </Button>
          </Option>
        )}
        {message && (
          <p className="px-4 pb-3 text-sm text-destructive">{message}</p>
        )}
      </Card>
      <Card>
        <Option
          name={
            <span className="flex items-center gap-2.5">
              <BrandIcon kind="bitwarden" />
              {backendName("bitwarden")}
            </span>
          }
          description={
            accounts.length
              ? t("options.backends.bitwarden.signedInDescription")
              : t("options.backends.bitwarden.signedOutDescription")
          }
        >
          {accounts.length ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("onboard")}
            >
              <PlusIcon />
              {t("options.backends.bitwarden.addAccount")}
            </Button>
          ) : (
            <Button size="sm" onClick={() => navigate("onboard")}>
              {t("options.backends.bitwarden.signIn")}
            </Button>
          )}
        </Option>
        {accounts.map((account) => (
          <Option
            key={account.id}
            name={account.email}
            description={
              account.server || t("options.backends.bitwarden.officialServer")
            }
          >
            <Button variant="outline" onClick={() => void signOut(account)}>
              {t("options.backends.bitwarden.signOut")}
            </Button>
          </Option>
        ))}
        {accounts.length > 0 && (
          <Option
            name={t("options.backends.autoLock.name")}
            description={t("options.backends.autoLock.description")}
          >
            <Select
              value={
                settings.autoLockMinutes === null
                  ? "never"
                  : String(settings.autoLockMinutes)
              }
              onValueChange={(value) =>
                update({
                  autoLockMinutes: value === "never" ? null : Number(value),
                })
              }
              items={lockTimes().map(([value, label]) => ({ value, label }))}
            >
              <SelectTrigger aria-label={t("options.backends.autoLock.label")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {lockTimes().map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Option>
        )}
      </Card>
      {targets.length > 0 && (
        <Section title={t("options.backends.saveTarget.title")}>
          <Card>
            <Option
              name={t("options.backends.saveTarget.name")}
              description={t("options.backends.saveTarget.description")}
            >
              <div className="w-64 max-w-full">
                <SourceSelect
                  sources={targets}
                  value={defaultTarget}
                  onChange={(id) => update({ defaultSaveTarget: id })}
                  label={t("options.backends.saveTarget.name")}
                />
              </div>
            </Option>
          </Card>
        </Section>
      )}
    </>
  )
}

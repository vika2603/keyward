import { type ReactNode, useEffect, useState } from "react"
import { callBackground, type ForwardingView } from "@/background/api"
import { notifyError } from "@/components/keyward/notify"
import { SecretInput } from "@/components/keyward/secret-input"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DEFAULT_BASE_URLS,
  emptyForwardingSettings,
  type ForwardingService,
  type ForwardingSettings,
  isForwardingService,
} from "@/lib/email-forwarding"
import type { UsernameOptions } from "@/lib/generator"
import { t } from "@/lib/i18n"
import { OptionRow } from "./option-row"

const SERVICE_NAMES: [ForwardingService, string][] = [
  ["simplelogin", "SimpleLogin"],
  ["addyio", "Addy.io"],
  ["fastmail", "Fastmail Masked Email"],
  ["firefoxRelay", "Firefox Relay"],
  ["duckduckgo", "DuckDuckGo Email Protection"],
  ["forwardEmail", "ForwardEmail"],
]

/** The forwarding settings where the background keeps them; each change is saved there at once. */
function useForwarding(accountId: string) {
  const [view, setView] = useState<ForwardingView | null>(null)

  useEffect(() => {
    let current = true
    callBackground("generator.forwarding", {
      accountId: accountId || undefined,
    }).then(
      (next) => {
        if (current) setView(next)
      },
      (error) => {
        if (current) notifyError(error)
      },
    )
    return () => {
      current = false
    }
  }, [accountId])

  const update = (
    service: ForwardingService,
    patch: Partial<ForwardingSettings>,
  ) => {
    if (!view?.saved) return
    const settings = {
      ...emptyForwardingSettings,
      ...view.saved[service],
      ...patch,
    }
    setView({ ...view, saved: { ...view.saved, [service]: settings } })
    void callBackground("generator.saveForwarding", {
      accountId: view.keeper === "bitwarden" ? view.account.id : undefined,
      service,
      settings,
    }).catch(notifyError)
  }

  return { view, update }
}

/**
 * The service a forwarded alias comes from and its API key, kept encrypted in a Bitwarden account,
 * or for the browser session without one.
 */
export function ForwardingOptions({
  options,
  generating,
  onChange,
  onGenerate,
  onUnlock,
}: {
  options: UsernameOptions
  generating: boolean
  onChange: (patch: Partial<UsernameOptions>) => void
  onGenerate: () => void
  /** Opens the unlock view of the Bitwarden vault `vaultId`. */
  onUnlock: (vaultId: string) => void
}) {
  const { view, update } = useForwarding(options.forwardingAccountId)
  const service = options.forwardingService
  const settings = view?.saved?.[service] ?? emptyForwardingSettings
  const needsDomain = service === "addyio" || service === "forwardEmail"
  const canGenerate =
    !generating &&
    Boolean(settings.apiKey.trim()) &&
    (!needsDomain || Boolean(settings.domain.trim()))

  const accountChoice = view?.keeper === "bitwarden" &&
    view.accounts.length > 1 && (
      <OptionRow label={t("popup.generator.forwardingAccount")}>
        <Select
          value={view.account.id}
          onValueChange={(accountId) => {
            if (accountId) onChange({ forwardingAccountId: accountId })
          }}
          items={view.accounts.map((account) => ({
            value: account.id,
            label: account.label,
          }))}
        >
          <SelectTrigger
            className="min-w-0 flex-1"
            aria-label={t("popup.generator.forwardingAccount")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {view.accounts.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {account.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </OptionRow>
    )

  let body: ReactNode = null
  if (view?.keeper === "bitwarden" && !view.saved) {
    const { account } = view
    body = (
      <div className="flex items-center gap-3 border-t px-3 py-2.5">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          {t("popup.generator.forwardingLocked", { account: account.label })}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onUnlock(account.vaultId)}
        >
          {t("unlock.unlock")}
        </Button>
      </div>
    )
  } else if (view) {
    body = (
      <>
        <OptionRow
          label={t("popup.generator.forwardingApiKey")}
          htmlFor="gen-forward-key"
          hint={
            view.keeper === "bitwarden"
              ? t("popup.generator.forwardingKeptIn", {
                  account: view.account.label,
                })
              : t("popup.generator.forwardingKeptForSession")
          }
        >
          <div className="min-w-0 flex-1">
            <SecretInput
              id="gen-forward-key"
              value={settings.apiKey}
              onChange={(event) =>
                update(service, { apiKey: event.target.value })
              }
            />
          </div>
        </OptionRow>
        {needsDomain && (
          <OptionRow
            label={t("popup.generator.forwardingDomain")}
            htmlFor="gen-forward-domain"
          >
            <Input
              id="gen-forward-domain"
              className="min-w-0 flex-1"
              spellCheck={false}
              autoComplete="off"
              placeholder="example.com"
              value={settings.domain}
              onChange={(event) =>
                update(service, { domain: event.target.value })
              }
            />
          </OptionRow>
        )}
        {DEFAULT_BASE_URLS[service] && (
          <OptionRow
            label={t("popup.generator.forwardingBaseUrl")}
            htmlFor="gen-forward-url"
          >
            <Input
              id="gen-forward-url"
              className="min-w-0 flex-1"
              spellCheck={false}
              autoComplete="off"
              placeholder={DEFAULT_BASE_URLS[service]}
              value={settings.baseUrl}
              onChange={(event) =>
                update(service, { baseUrl: event.target.value })
              }
            />
          </OptionRow>
        )}
        <div className="border-t px-3 py-2.5">
          <Button
            type="button"
            className="w-full"
            size="sm"
            disabled={!canGenerate}
            onClick={onGenerate}
          >
            {t("popup.generator.generateAlias")}
          </Button>
        </div>
      </>
    )
  }

  return (
    <>
      <OptionRow label={t("popup.generator.forwardingService")}>
        <Select
          value={service}
          onValueChange={(next) => {
            if (isForwardingService(next)) onChange({ forwardingService: next })
          }}
          items={SERVICE_NAMES.map(([value, label]) => ({ value, label }))}
        >
          <SelectTrigger
            className="min-w-0 flex-1"
            aria-label={t("popup.generator.forwardingService")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {SERVICE_NAMES.map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </OptionRow>
      {accountChoice}
      {body}
    </>
  )
}

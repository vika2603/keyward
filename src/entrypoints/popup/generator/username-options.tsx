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
import type { ForwardingService } from "@/lib/email-forwarding"
import type { UsernameOptions, UsernameType } from "@/lib/generator"
import { type MessageKey, t } from "@/lib/i18n"
import { CheckboxOption, OptionRow } from "./option-row"

const USERNAME_TYPES: [UsernameType, MessageKey][] = [
  ["word", "popup.generator.usernameType.word"],
  ["plusEmail", "popup.generator.usernameType.plusEmail"],
  ["catchAll", "popup.generator.usernameType.catchAll"],
  ["forwarded", "popup.generator.usernameType.forwarded"],
]

const FORWARDING_SERVICES: [ForwardingService, string][] = [
  ["simplelogin", "SimpleLogin"],
  ["addyio", "Addy.io"],
  ["fastmail", "Fastmail Masked Email"],
  ["firefoxRelay", "Firefox Relay"],
  ["duckduckgo", "DuckDuckGo Email Protection"],
  ["forwardEmail", "ForwardEmail"],
]

/** A username's type, and the word options, address, or forwarding API settings it uses. */
export function UsernameOptionsForm({
  options,
  generatingAlias = false,
  onChange,
  onGenerateAlias,
}: {
  options: UsernameOptions
  generatingAlias?: boolean
  onChange: (patch: Partial<UsernameOptions>) => void
  onGenerateAlias?: () => void
}) {
  const plusEmail = options.type === "plusEmail"
  const forwarded = options.type === "forwarded"
  const needsDomain =
    options.forwardingService === "addyio" ||
    options.forwardingService === "forwardEmail"
  const supportsBaseUrl =
    options.forwardingService === "simplelogin" ||
    options.forwardingService === "addyio"
  const canCreateAlias =
    !generatingAlias &&
    Boolean(options.forwardingApiKey.trim()) &&
    (!needsDomain || Boolean(options.forwardingDomain.trim()))

  return (
    <div>
      <OptionRow label={t("popup.generator.usernameType")}>
        <Select
          value={options.type}
          onValueChange={(type) => {
            if (type) onChange({ type })
          }}
          items={USERNAME_TYPES.map(([type, label]) => ({
            value: type,
            label: t(label),
          }))}
        >
          <SelectTrigger
            className="min-w-0 flex-1"
            aria-label={t("popup.generator.usernameType")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {USERNAME_TYPES.map(([type, label]) => (
                <SelectItem key={type} value={type}>
                  {t(label)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </OptionRow>
      {options.type === "word" && (
        <OptionRow label={t("popup.generator.options")}>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <CheckboxOption
              checked={options.capitalize}
              onChange={(capitalize) => onChange({ capitalize })}
              label={t("popup.generator.capitalize")}
            />
            <CheckboxOption
              checked={options.includeNumber}
              onChange={(includeNumber) => onChange({ includeNumber })}
              label={t("popup.generator.includeNumber")}
            />
          </div>
        </OptionRow>
      )}
      {(plusEmail || options.type === "catchAll") && (
        <OptionRow
          label={
            plusEmail ? t("popup.generator.email") : t("popup.generator.domain")
          }
          htmlFor="gen-address"
          hint={
            plusEmail
              ? t("popup.generator.emailHint")
              : t("popup.generator.domainHint")
          }
        >
          <Input
            id="gen-address"
            className="min-w-0 flex-1"
            spellCheck={false}
            autoComplete="off"
            placeholder={plusEmail ? "name@example.com" : "example.com"}
            value={plusEmail ? options.email : options.domain}
            onChange={(event) =>
              onChange(
                plusEmail
                  ? { email: event.target.value }
                  : { domain: event.target.value },
              )
            }
          />
        </OptionRow>
      )}
      {forwarded && (
        <>
          <OptionRow label={t("popup.generator.forwardingService")}>
            <Select
              value={options.forwardingService}
              onValueChange={(service) => {
                if (service)
                  onChange({
                    forwardingService: service as ForwardingService,
                  })
              }}
              items={FORWARDING_SERVICES.map(([value, label]) => ({
                value,
                label,
              }))}
            >
              <SelectTrigger
                className="min-w-0 flex-1"
                aria-label={t("popup.generator.forwardingService")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {FORWARDING_SERVICES.map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </OptionRow>
          <OptionRow
            label={t("popup.generator.forwardingApiKey")}
            htmlFor="gen-forward-key"
          >
            <div className="min-w-0 flex-1">
              <SecretInput
                id="gen-forward-key"
                value={options.forwardingApiKey}
                onChange={(event) =>
                  onChange({ forwardingApiKey: event.target.value })
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
                value={options.forwardingDomain}
                onChange={(event) =>
                  onChange({ forwardingDomain: event.target.value })
                }
              />
            </OptionRow>
          )}
          {supportsBaseUrl && (
            <OptionRow
              label={t("popup.generator.forwardingBaseUrl")}
              htmlFor="gen-forward-url"
            >
              <Input
                id="gen-forward-url"
                className="min-w-0 flex-1"
                spellCheck={false}
                autoComplete="off"
                placeholder={
                  options.forwardingService === "simplelogin"
                    ? "https://app.simplelogin.io"
                    : "https://app.addy.io"
                }
                value={options.forwardingBaseUrl}
                onChange={(event) =>
                  onChange({ forwardingBaseUrl: event.target.value })
                }
              />
            </OptionRow>
          )}
          <div className="border-t px-3 py-2.5">
            <Button
              type="button"
              className="w-full"
              size="sm"
              disabled={!canCreateAlias}
              onClick={onGenerateAlias}
            >
              {t("popup.generator.generateAlias")}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

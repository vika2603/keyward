import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { UsernameOptions, UsernameType } from "@/lib/generator"
import { type MessageKey, t } from "@/lib/i18n"
import { ForwardingOptions } from "./forwarding-options"
import { CheckboxOption, OptionRow } from "./option-row"

const USERNAME_TYPES: [UsernameType, MessageKey][] = [
  ["word", "popup.generator.usernameType.word"],
  ["plusEmail", "popup.generator.usernameType.plusEmail"],
  ["catchAll", "popup.generator.usernameType.catchAll"],
  ["forwarded", "popup.generator.usernameType.forwarded"],
]

/** A username's type, and the word options, address, or forwarding API settings it uses. */
export function UsernameOptionsForm({
  options,
  generatingAlias,
  onChange,
  onGenerateAlias,
  onUnlock,
}: {
  options: UsernameOptions
  generatingAlias: boolean
  onChange: (patch: Partial<UsernameOptions>) => void
  onGenerateAlias: () => void
  /** Opens the unlock view of the Bitwarden vault `vaultId`. */
  onUnlock: (vaultId: string) => void
}) {
  const plusEmail = options.type === "plusEmail"

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
      {options.type === "forwarded" && (
        <ForwardingOptions
          options={options}
          generating={generatingAlias}
          onChange={onChange}
          onGenerate={onGenerateAlias}
          onUnlock={onUnlock}
        />
      )}
    </div>
  )
}

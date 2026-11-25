import { Input } from "@/components/ui/input"
import { type PassphraseOptions, WORDS_MAX, WORDS_MIN } from "@/lib/generator"
import { t } from "@/lib/i18n"
import { CheckboxOption, NumberInput, OptionRow } from "./option-row"

/** A passphrase's word count, separator, capitals and number. */
export function PassphraseOptionsForm({
  options,
  onChange,
}: {
  options: PassphraseOptions
  onChange: (patch: Partial<PassphraseOptions>) => void
}) {
  return (
    <div>
      <OptionRow
        label={t("popup.generator.words")}
        htmlFor="gen-words"
        hint={t("popup.generator.wordsHint", {
          min: WORDS_MIN,
          max: WORDS_MAX,
        })}
      >
        <NumberInput
          id="gen-words"
          className="w-20"
          min={WORDS_MIN}
          max={WORDS_MAX}
          value={options.words}
          onValueChange={(words) => onChange({ words })}
        />
      </OptionRow>
      <OptionRow label={t("popup.generator.separator")} htmlFor="gen-separator">
        <Input
          id="gen-separator"
          className="w-20 font-mono"
          maxLength={1}
          spellCheck={false}
          value={options.separator}
          onChange={(event) => onChange({ separator: event.target.value })}
        />
      </OptionRow>
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
    </div>
  )
}

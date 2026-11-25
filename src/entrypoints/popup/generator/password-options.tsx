import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import {
  type GeneratorOptions,
  LENGTH_MAX,
  LENGTH_MIN,
  MINIMUM_COUNT_MAX,
} from "@/lib/generator"
import { t } from "@/lib/i18n"
import { CheckboxOption, NumberInput, OptionRow } from "./option-row"

const CLASSES = [
  ["upper", "popup.generator.upper"],
  ["lower", "popup.generator.lower"],
  ["digits", "popup.generator.digits"],
  ["symbols", "popup.generator.symbols"],
] as const

type CharacterClass = (typeof CLASSES)[number][0]

/** A password's length, character types, symbol set, minimum counts and ambiguity setting. */
export function PasswordOptionsForm({
  options,
  onChange,
}: {
  options: GeneratorOptions
  onChange: (patch: Partial<GeneratorOptions>) => void
}) {
  const toggleClass = (characterClass: CharacterClass) => {
    const enabled = CLASSES.filter(([key]) => options[key]).length
    // At least one character class stays on.
    if (options[characterClass] && enabled === 1) return
    onChange({ [characterClass]: !options[characterClass] })
  }

  return (
    <div>
      <OptionRow label={t("popup.generator.length")} labelId="gen-length">
        <Slider
          className="min-w-0 flex-1"
          aria-labelledby="gen-length"
          min={LENGTH_MIN}
          max={LENGTH_MAX}
          value={options.length}
          onValueChange={(next) =>
            onChange({
              length: Array.isArray(next) ? (next[0] ?? options.length) : next,
            })
          }
        />
        <NumberInput
          className="w-20 shrink-0"
          aria-labelledby="gen-length"
          min={LENGTH_MIN}
          max={LENGTH_MAX}
          value={options.length}
          onValueChange={(length) => onChange({ length })}
        />
      </OptionRow>
      <OptionRow
        label={t("popup.generator.include")}
        groupLabel={t("popup.generator.classesLabel")}
      >
        {CLASSES.map(([key, label]) => (
          <CheckboxOption
            key={key}
            checked={options[key]}
            onChange={() => toggleClass(key)}
            label={t(label)}
          />
        ))}
      </OptionRow>
      <OptionRow label={t("popup.generator.symbolSet")} htmlFor="gen-symbols">
        <Input
          id="gen-symbols"
          className="min-w-0 flex-1 font-mono"
          value={options.symbolSet}
          disabled={!options.symbols}
          spellCheck={false}
          onChange={(event) => onChange({ symbolSet: event.target.value })}
        />
      </OptionRow>
      <OptionRow label={t("popup.generator.minimum")}>
        <div className="flex items-center gap-2">
          <label htmlFor="gen-minimum-digits" className="text-sm">
            {t("popup.generator.digits")}
          </label>
          <NumberInput
            id="gen-minimum-digits"
            className="w-14"
            aria-label={t("popup.generator.minimumDigits")}
            min={0}
            max={MINIMUM_COUNT_MAX}
            value={options.minimumDigits}
            disabled={!options.digits}
            onValueChange={(minimumDigits) => onChange({ minimumDigits })}
          />
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="gen-minimum-symbols" className="text-sm">
            {t("popup.generator.symbols")}
          </label>
          <NumberInput
            id="gen-minimum-symbols"
            className="w-14"
            aria-label={t("popup.generator.minimumSymbols")}
            min={0}
            max={MINIMUM_COUNT_MAX}
            value={options.minimumSymbols}
            disabled={!options.symbols}
            onValueChange={(minimumSymbols) => onChange({ minimumSymbols })}
          />
        </div>
      </OptionRow>
      <OptionRow label={t("popup.generator.options")}>
        <CheckboxOption
          checked={options.avoidAmbiguousCharacters}
          onChange={(avoidAmbiguousCharacters) =>
            onChange({ avoidAmbiguousCharacters })
          }
          label={t("popup.generator.avoidAmbiguous")}
        />
      </OptionRow>
    </div>
  )
}

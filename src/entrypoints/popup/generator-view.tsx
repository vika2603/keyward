import { CheckIcon, CopyIcon, HistoryIcon, RefreshCwIcon } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { callBackground } from "@/background/api"
import { useCopyThrough } from "@/components/keyward/copy-through"
import { errorMessage } from "@/components/keyward/errors"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import {
  defaultGeneratorOptions,
  type GeneratorOptions,
  generatedPasswordItem,
  generatePassword,
  generatorOptionsItem,
  LENGTH_MAX,
  LENGTH_MIN,
} from "@/lib/generator"
import { t } from "@/lib/i18n"
import { BackHeader } from "./header"

const CLASSES = [
  ["upper", "popup.generator.upper"],
  ["lower", "popup.generator.lower"],
  ["digits", "popup.generator.digits"],
  ["symbols", "popup.generator.symbols"],
] as const

function charClass(char: string): string | undefined {
  if (/[0-9]/.test(char)) return "text-blue-600 dark:text-blue-400"
  if (/[a-zA-Z]/.test(char)) return undefined
  return "text-amber-700 dark:text-amber-400"
}

export function GeneratorView({
  onBack,
  onHistory,
}: {
  onBack: () => void
  onHistory: () => void
}) {
  const [options, setOptions] = useState<GeneratorOptions | null>(null)
  const [password, setPassword] = useState("")
  const [copied, setCopied] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const shown = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void Promise.all([
      generatorOptionsItem.getValue(),
      generatedPasswordItem.getValue(),
    ]).then(([saved, current]) => {
      const value = { ...defaultGeneratorOptions, ...saved }
      setOptions(value)
      const next = current ?? generatePassword(value)
      setPassword(next)
      if (!current) void generatedPasswordItem.setValue(next)
    })
  }, [])

  const show = (next: string) => {
    setPassword(next)
    void generatedPasswordItem.setValue(next)
  }

  const copy = useCallback(async () => {
    setMessage(null)
    try {
      await callBackground("generator.copy", { password })
      setCopied(true)
    } catch (error) {
      setMessage(errorMessage(error))
    }
  }, [password])
  useCopyThrough(
    shown,
    useCallback(() => void copy(), [copy]),
  )

  if (!options) return <div className="h-[276px]" />

  const update = (patch: Partial<GeneratorOptions>) => {
    const next = { ...options, ...patch }
    setOptions(next)
    show(generatePassword(next))
    setCopied(false)
    void generatorOptionsItem.setValue(next)
  }

  const toggle = (key: (typeof CLASSES)[number][0]) => {
    const enabled = CLASSES.filter(([k]) => options[k]).length
    // At least one character class stays on.
    if (options[key] && enabled === 1) return
    update({ [key]: !options[key] })
  }

  return (
    <div className="flex min-h-[276px] flex-col">
      <BackHeader title={t("popup.generator.title")} onBack={onBack}>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("popup.history.title")}
          title={t("popup.history.title")}
          onClick={onHistory}
        >
          <HistoryIcon />
        </Button>
      </BackHeader>
      <div className="px-3 pb-3">
        <div className="flex min-h-14 items-center gap-1 rounded-xl bg-card py-2 pr-2 pl-3 ring-1 ring-foreground/10">
          <div
            ref={shown}
            className="min-w-0 flex-1 font-mono text-base leading-normal break-all select-all"
          >
            {[...password].map((char, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: characters repeat; their position is their identity.
              <span key={index} className={charClass(char)}>
                {char}
              </span>
            ))}
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("popup.generator.regenerate")}
            title={t("popup.generator.regenerate")}
            onClick={() => update({})}
          >
            <RefreshCwIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={copied ? t("popup.copied") : t("popup.copyPassword")}
            title={copied ? t("popup.copied") : t("popup.copyPassword")}
            onClick={() => void copy()}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </Button>
        </div>
        {message && <p className="pt-2 text-xs text-destructive">{message}</p>}
      </div>
      <Separator />
      <div className="flex items-center gap-3 px-3 py-2 min-h-[52px]">
        <span id="gen-length" className="w-14 shrink-0 text-sm font-medium">
          {t("popup.generator.length")}
        </span>
        <Slider
          className="min-w-0 flex-1"
          aria-labelledby="gen-length"
          min={LENGTH_MIN}
          max={LENGTH_MAX}
          value={options.length}
          onValueChange={(value) =>
            update({
              length: Array.isArray(value)
                ? (value[0] ?? options.length)
                : value,
            })
          }
        />
        <span className="w-6 shrink-0 text-right font-mono text-sm">
          {options.length}
        </span>
      </div>
      <fieldset
        className="flex min-h-[52px] min-w-0 items-center gap-3 border-t px-3 py-2"
        aria-label={t("popup.generator.classesLabel")}
      >
        <span className="w-14 shrink-0 text-sm font-medium">
          {t("popup.generator.include")}
        </span>
        {CLASSES.map(([key, label]) => (
          <label
            key={key}
            className="flex items-center gap-1.5 text-sm whitespace-nowrap"
          >
            <Checkbox
              checked={options[key]}
              onCheckedChange={() => toggle(key)}
            />
            {t(label)}
          </label>
        ))}
      </fieldset>
      <div className="flex min-h-[52px] items-center gap-3 border-t px-3 py-2">
        <label
          htmlFor="gen-symbols"
          className="w-14 shrink-0 text-sm font-medium"
        >
          {t("popup.generator.symbolSet")}
        </label>
        <Input
          id="gen-symbols"
          className="min-w-0 flex-1 font-mono"
          value={options.symbolSet}
          disabled={!options.symbols}
          spellCheck={false}
          onChange={(event) => update({ symbolSet: event.target.value })}
        />
      </div>
    </div>
  )
}

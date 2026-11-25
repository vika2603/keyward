import { CheckIcon, CopyIcon, HistoryIcon, RefreshCwIcon } from "lucide-react"
import {
  type ComponentProps,
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import { callBackground } from "@/background/api"
import { useCopyThrough } from "@/components/keyward/copy-through"
import { errorMessage } from "@/components/keyward/errors"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  defaultGeneratorChoices,
  type GeneratorChoices,
  type GeneratorKind,
  type GeneratorOptions,
  generatedItem,
  generatePassphrase,
  generatePassword,
  generateUsername,
  generatorChoicesItem,
  generatorOptionsItem,
  getGeneratorOptions,
  LENGTH_MAX,
  LENGTH_MIN,
  loadWords,
  MINIMUM_COUNT_MAX,
  type PassphraseOptions,
  passwordLength,
  type UsernameOptions,
  type UsernameType,
  WORDS_MAX,
  WORDS_MIN,
} from "@/lib/generator"
import { type MessageKey, t } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { BackHeader } from "./header"

const KINDS: [GeneratorKind, MessageKey][] = [
  ["password", "popup.generator.kind.password"],
  ["passphrase", "popup.generator.kind.passphrase"],
  ["username", "popup.generator.kind.username"],
]

const CLASSES = [
  ["upper", "popup.generator.upper"],
  ["lower", "popup.generator.lower"],
  ["digits", "popup.generator.digits"],
  ["symbols", "popup.generator.symbols"],
] as const

const USERNAME_TYPES: [UsernameType, MessageKey][] = [
  ["word", "popup.generator.usernameType.word"],
  ["plusEmail", "popup.generator.usernameType.plusEmail"],
  ["catchAll", "popup.generator.usernameType.catchAll"],
]

function charClass(char: string): string | undefined {
  if (/[0-9]/.test(char)) return "text-blue-600 dark:text-blue-400"
  if (/[a-zA-Z]/.test(char)) return undefined
  return "text-amber-700 dark:text-amber-400"
}

/** A row of the options list: a label on the left and its controls. */
function Row({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-[52px] items-center gap-3 border-t px-3 py-2">
      <label htmlFor={htmlFor} className="w-16 shrink-0 text-sm font-medium">
        {label}
      </label>
      {children}
    </div>
  )
}

function CheckboxOption({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}) {
  return (
    <label className="flex items-center gap-1.5 text-sm whitespace-nowrap">
      <Checkbox checked={checked} onCheckedChange={() => onChange(!checked)} />
      {label}
    </label>
  )
}

/** A number input that keeps what is typed and reports it once it is a whole number from `min` to `max`. */
function NumberInput({
  value,
  min,
  max,
  onValueChange,
  ...props
}: Omit<
  ComponentProps<typeof Input>,
  "type" | "value" | "min" | "max" | "onChange" | "onBlur"
> & {
  value: number
  min: number
  max: number
  onValueChange: (value: number) => void
}) {
  // Typing a number passes through values out of range, such as "1" on the way to "128".
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <Input
      {...props}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={draft ?? String(value)}
      onChange={(event) => {
        const text = event.target.value
        const number = Number(text)
        setDraft(text)
        if (
          text !== "" &&
          Number.isInteger(number) &&
          number >= min &&
          number <= max
        )
          onValueChange(number)
      }}
      onBlur={() => setDraft(null)}
    />
  )
}

/** Generates passwords, passphrases and usernames; the shown values last for the browser session. */
export function GeneratorView({
  onBack,
  onHistory,
}: {
  onBack: () => void
  onHistory: () => void
}) {
  const [password, setPassword] = useState<GeneratorOptions | null>(null)
  const [choices, setChoices] = useState<GeneratorChoices | null>(null)
  const [values, setValues] = useState<Partial<Record<GeneratorKind, string>>>(
    {},
  )
  const [words, setWords] = useState<string[] | null>(null)
  const [copied, setCopied] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const shown = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void Promise.all([
      getGeneratorOptions(),
      generatorChoicesItem.getValue(),
      generatedItem.getValue(),
    ]).then(([savedPassword, savedChoices, savedValues]) => {
      setPassword(savedPassword)
      setChoices({
        ...defaultGeneratorChoices,
        ...savedChoices,
        passphrase: {
          ...defaultGeneratorChoices.passphrase,
          ...savedChoices?.passphrase,
        },
        username: {
          ...defaultGeneratorChoices.username,
          ...savedChoices?.username,
        },
      })
      setValues(savedValues ?? {})
    })
  }, [])

  const kind = choices?.kind ?? "password"
  const needsWords = kind !== "password"
  useEffect(() => {
    if (needsWords && !words) void loadWords().then(setWords)
  }, [needsWords, words])

  const show = useCallback((which: GeneratorKind, value: string | null) => {
    setCopied(false)
    setValues((current) => {
      const next = { ...current }
      if (value === null) delete next[which]
      else next[which] = value
      void generatedItem.setValue(next)
      return next
    })
  }, [])

  /** A new value for a kind, or null while the word list loads or a username needs more input. */
  const generate = useCallback(
    (
      which: GeneratorKind,
      passwordOptions: GeneratorOptions,
      current: GeneratorChoices,
    ): string | null => {
      if (which === "password") return generatePassword(passwordOptions)
      if (!words) return null
      return which === "passphrase"
        ? generatePassphrase(current.passphrase, words)
        : generateUsername(current.username, words)
    },
    [words],
  )

  // A kind shown for the first time this session gets a value once it can be generated.
  useEffect(() => {
    if (!password || !choices || values[kind] !== undefined) return
    const value = generate(kind, password, choices)
    if (value !== null) show(kind, value)
  }, [password, choices, values, kind, generate, show])

  const value = values[kind] ?? null
  const secret = kind !== "username"

  const copy = useCallback(async () => {
    if (value === null) return
    setMessage(null)
    try {
      if (secret) await callBackground("generator.copy", { password: value })
      else await callBackground("popup.copyText", { text: value })
      setCopied(true)
    } catch (error) {
      setMessage(errorMessage(error))
    }
  }, [value, secret])
  useCopyThrough(
    shown,
    useCallback(() => void copy(), [copy]),
  )

  if (!password || !choices) return <div className="h-[276px]" />

  const updatePassword = (patch: Partial<GeneratorOptions>) => {
    const changed = { ...password, ...patch }
    // The saved length follows the generated one, so the length controls show the length the password has.
    const next = { ...changed, length: passwordLength(changed) }
    setPassword(next)
    void generatorOptionsItem.setValue(next)
    show("password", generatePassword(next))
  }

  const updateChoices = (next: GeneratorChoices, regenerate: boolean) => {
    setChoices(next)
    void generatorChoicesItem.setValue(next)
    if (regenerate) show(next.kind, generate(next.kind, password, next))
  }
  const updatePassphrase = (patch: Partial<PassphraseOptions>) =>
    updateChoices(
      { ...choices, passphrase: { ...choices.passphrase, ...patch } },
      true,
    )
  const updateUsername = (patch: Partial<UsernameOptions>) =>
    updateChoices(
      { ...choices, username: { ...choices.username, ...patch } },
      true,
    )

  const togglePasswordClass = (key: (typeof CLASSES)[number][0]) => {
    const enabled = CLASSES.filter(([k]) => password[k]).length
    // At least one character class stays on.
    if (password[key] && enabled === 1) return
    updatePassword({ [key]: !password[key] })
  }

  const username = choices.username
  const pending =
    kind === "username" && username.type === "plusEmail"
      ? t("popup.generator.needEmail")
      : kind === "username" && username.type === "catchAll"
        ? t("popup.generator.needDomain")
        : null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-2 px-3 pb-3">
          <Tabs
            value={kind}
            onValueChange={(next) =>
              updateChoices({ ...choices, kind: next as GeneratorKind }, false)
            }
          >
            <TabsList
              className="w-full"
              aria-label={t("popup.generator.kindsLabel")}
            >
              {KINDS.map(([key, label]) => (
                <TabsTrigger key={key} value={key}>
                  {t(label)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="flex min-h-14 items-center gap-1 rounded-xl bg-card py-2 pr-2 pl-3 ring-1 ring-foreground/10">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              {value !== null ? (
                <div
                  ref={shown}
                  className={cn(
                    "font-mono text-base leading-normal select-all",
                    kind === "password"
                      ? "break-all"
                      : "[overflow-wrap:anywhere]",
                  )}
                >
                  {kind === "password"
                    ? [...value].map((char, index) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: characters repeat; their position is their identity.
                        <span key={index} className={charClass(char)}>
                          {char}
                        </span>
                      ))
                    : // An email address may wrap after its "+" and "@" rather than mid-word.
                      value.split(/(?<=[+@])/).map((part, index) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: parts repeat; their position is their identity.
                        <Fragment key={index}>
                          {index > 0 && <wbr />}
                          {part}
                        </Fragment>
                      ))}
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">
                  {pending ?? "…"}
                </span>
              )}
              {kind === "passphrase" && value !== null && (
                <span className="text-xs text-muted-foreground">
                  {t("popup.generator.passphraseLength", {
                    count: value.length,
                  })}
                </span>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("popup.generator.regenerate")}
              title={t("popup.generator.regenerate")}
              disabled={value === null}
              onClick={() => show(kind, generate(kind, password, choices))}
            >
              <RefreshCwIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={
                copied ? t("popup.copied") : t("popup.generator.copy")
              }
              title={copied ? t("popup.copied") : t("popup.generator.copy")}
              disabled={value === null}
              onClick={() => void copy()}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </Button>
          </div>
          {message && <p className="text-xs text-destructive">{message}</p>}
        </div>
        <Separator />
        {kind === "password" && (
          <>
            <div className="flex min-h-[52px] items-center gap-3 px-3 py-2">
              <span
                id="gen-length"
                className="w-16 shrink-0 text-sm font-medium"
              >
                {t("popup.generator.length")}
              </span>
              <Slider
                className="min-w-0 flex-1"
                aria-labelledby="gen-length"
                min={LENGTH_MIN}
                max={LENGTH_MAX}
                value={password.length}
                onValueChange={(next) =>
                  updatePassword({
                    length: Array.isArray(next)
                      ? (next[0] ?? password.length)
                      : next,
                  })
                }
              />
              <NumberInput
                className="w-20 shrink-0"
                aria-labelledby="gen-length"
                min={LENGTH_MIN}
                max={LENGTH_MAX}
                value={password.length}
                onValueChange={(length) => updatePassword({ length })}
              />
            </div>
            <fieldset
              className="flex min-h-[52px] min-w-0 items-center gap-3 border-t px-3 py-2"
              aria-label={t("popup.generator.classesLabel")}
            >
              <span className="w-16 shrink-0 text-sm font-medium">
                {t("popup.generator.include")}
              </span>
              {CLASSES.map(([key, label]) => (
                <CheckboxOption
                  key={key}
                  checked={password[key]}
                  onChange={() => togglePasswordClass(key)}
                  label={t(label)}
                />
              ))}
            </fieldset>
            <Row label={t("popup.generator.symbolSet")} htmlFor="gen-symbols">
              <Input
                id="gen-symbols"
                className="min-w-0 flex-1 font-mono"
                value={password.symbolSet}
                disabled={!password.symbols}
                spellCheck={false}
                onChange={(event) =>
                  updatePassword({ symbolSet: event.target.value })
                }
              />
            </Row>
            <div className="grid min-h-[52px] grid-cols-2 items-center gap-3 border-t px-3 py-2">
              <div className="flex items-center gap-3">
                <label
                  htmlFor="gen-minimum-digits"
                  className="w-16 shrink-0 text-sm font-medium"
                >
                  {t("popup.generator.minimumDigits")}
                </label>
                <NumberInput
                  id="gen-minimum-digits"
                  className="w-14"
                  min={0}
                  max={MINIMUM_COUNT_MAX}
                  value={password.minimumDigits}
                  disabled={!password.digits}
                  onValueChange={(minimumDigits) =>
                    updatePassword({ minimumDigits })
                  }
                />
              </div>
              <div className="flex items-center gap-3">
                <label
                  htmlFor="gen-minimum-symbols"
                  className="w-16 shrink-0 text-sm font-medium"
                >
                  {t("popup.generator.minimumSymbols")}
                </label>
                <NumberInput
                  id="gen-minimum-symbols"
                  className="w-14"
                  min={0}
                  max={MINIMUM_COUNT_MAX}
                  value={password.minimumSymbols}
                  disabled={!password.symbols}
                  onValueChange={(minimumSymbols) =>
                    updatePassword({ minimumSymbols })
                  }
                />
              </div>
            </div>
            <Row label={t("popup.generator.options")}>
              <CheckboxOption
                checked={password.avoidAmbiguousCharacters}
                onChange={(avoidAmbiguousCharacters) =>
                  updatePassword({ avoidAmbiguousCharacters })
                }
                label={t("popup.generator.avoidAmbiguous")}
              />
            </Row>
          </>
        )}
        {kind === "passphrase" && (
          <>
            <div className="flex flex-col gap-1.5 px-3 py-2">
              <div className="flex min-h-9 items-center gap-3">
                <label
                  htmlFor="gen-words"
                  className="w-16 shrink-0 text-sm font-medium"
                >
                  {t("popup.generator.words")}
                </label>
                <Input
                  id="gen-words"
                  type="number"
                  className="w-20"
                  min={WORDS_MIN}
                  max={WORDS_MAX}
                  value={choices.passphrase.words}
                  onChange={(event) => {
                    const count = Number(event.target.value)
                    if (count >= WORDS_MIN && count <= WORDS_MAX)
                      updatePassphrase({ words: count })
                  }}
                />
              </div>
              <p className="pl-[76px] text-xs text-muted-foreground">
                {t("popup.generator.wordsHint", {
                  min: WORDS_MIN,
                  max: WORDS_MAX,
                })}
              </p>
            </div>
            <Row label={t("popup.generator.separator")} htmlFor="gen-separator">
              <Input
                id="gen-separator"
                className="w-20 font-mono"
                maxLength={1}
                spellCheck={false}
                value={choices.passphrase.separator}
                onChange={(event) =>
                  updatePassphrase({ separator: event.target.value })
                }
              />
            </Row>
            <Row label={t("popup.generator.options")}>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <CheckboxOption
                  checked={choices.passphrase.capitalize}
                  onChange={(capitalize) => updatePassphrase({ capitalize })}
                  label={t("popup.generator.capitalize")}
                />
                <CheckboxOption
                  checked={choices.passphrase.includeNumber}
                  onChange={(includeNumber) =>
                    updatePassphrase({ includeNumber })
                  }
                  label={t("popup.generator.includeNumber")}
                />
              </div>
            </Row>
          </>
        )}
        {kind === "username" && (
          <>
            <div className="flex min-h-[52px] items-center gap-3 px-3 py-2">
              <span className="w-16 shrink-0 text-sm font-medium">
                {t("popup.generator.usernameType")}
              </span>
              <Select
                value={username.type}
                onValueChange={(next) =>
                  updateUsername({ type: next as UsernameType })
                }
                items={USERNAME_TYPES.map(([key, label]) => ({
                  value: key,
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
                  {USERNAME_TYPES.map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {t(label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {username.type === "word" && (
              <Row label={t("popup.generator.options")}>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <CheckboxOption
                    checked={username.capitalize}
                    onChange={(capitalize) => updateUsername({ capitalize })}
                    label={t("popup.generator.capitalize")}
                  />
                  <CheckboxOption
                    checked={username.includeNumber}
                    onChange={(includeNumber) =>
                      updateUsername({ includeNumber })
                    }
                    label={t("popup.generator.includeNumber")}
                  />
                </div>
              </Row>
            )}
            {username.type !== "word" && (
              <div className="flex flex-col gap-1.5 border-t px-3 py-2">
                <div className="flex min-h-9 items-center gap-3">
                  <label
                    htmlFor="gen-address"
                    className="w-16 shrink-0 text-sm font-medium"
                  >
                    {username.type === "plusEmail"
                      ? t("popup.generator.email")
                      : t("popup.generator.domain")}
                  </label>
                  <Input
                    id="gen-address"
                    className="min-w-0 flex-1"
                    spellCheck={false}
                    autoComplete="off"
                    placeholder={
                      username.type === "plusEmail"
                        ? "name@example.com"
                        : "example.com"
                    }
                    value={
                      username.type === "plusEmail"
                        ? username.email
                        : username.domain
                    }
                    onChange={(event) =>
                      updateUsername(
                        username.type === "plusEmail"
                          ? { email: event.target.value }
                          : { domain: event.target.value },
                      )
                    }
                  />
                </div>
                <p className="pl-[76px] text-xs text-muted-foreground">
                  {username.type === "plusEmail"
                    ? t("popup.generator.emailHint")
                    : t("popup.generator.domainHint")}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

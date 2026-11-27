import { useCallback, useEffect, useState } from "react"
import { callBackground } from "@/background/api"
import { errorMessage, isUnsupportedRequest } from "@/components/keyward/errors"
import { notifyError } from "@/components/keyward/notify"
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
  loadWords,
  type PassphraseOptions,
  passwordLength,
  type UsernameOptions,
} from "@/lib/generator"

type ShownValues = Partial<Record<GeneratorKind, string>>

/**
 * When a shown value enters the history: at once, or, for a value that follows an option as it
 * changes, once no other value replaces it for a moment.
 */
type Recording = "now" | "whenSettled"

/**
 * Puts a shown value in the history. A background from before the history kept every value lacks
 * the request; copying still records the value there, so the generator carries on without it.
 */
export async function recordShown(
  value: string,
  kind: GeneratorKind,
  recording: Recording = "now",
): Promise<void> {
  try {
    await callBackground("generator.shown", {
      value,
      kind,
      settle: recording === "whenSettled",
    })
  } catch (error) {
    if (!isUnsupportedRequest(error)) throw error
  }
}

/** Saved choices, with the defaults for parts saved before they existed. */
function withDefaults(saved: GeneratorChoices | null): GeneratorChoices {
  return {
    ...defaultGeneratorChoices,
    ...saved,
    passphrase: { ...defaultGeneratorChoices.passphrase, ...saved?.passphrase },
    username: { ...defaultGeneratorChoices.username, ...saved?.username },
  }
}

/**
 * The generator's options and the value shown for each kind, kept in storage: the options for good,
 * the values for the browser session. Each change of an option saves it and shows a new value.
 */
export function useGeneratorState() {
  const [passwordOptions, setPasswordOptions] =
    useState<GeneratorOptions | null>(null)
  const [choices, setChoices] = useState<GeneratorChoices | null>(null)
  const [values, setValues] = useState<ShownValues>({})
  const [words, setWords] = useState<string[] | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [generatingAlias, setGeneratingAlias] = useState(false)

  useEffect(() => {
    void Promise.all([
      getGeneratorOptions(),
      generatorChoicesItem.getValue(),
      generatedItem.getValue(),
    ]).then(([savedPasswordOptions, savedChoices, savedValues]) => {
      setPasswordOptions(savedPasswordOptions)
      setChoices(withDefaults(savedChoices))
      setValues(savedValues ?? {})
    })
  }, [])

  const kind = choices?.kind ?? "password"
  const needsWords = kind !== "password"
  useEffect(() => {
    if (needsWords && !words) void loadWords().then(setWords)
  }, [needsWords, words])

  const show = useCallback(
    (which: GeneratorKind, value: string | null, recording: Recording) => {
      const next = { ...values }
      if (value === null) delete next[which]
      else next[which] = value
      setValues(next)
      void generatedItem.setValue(next)
      if (value !== null)
        void recordShown(value, which, recording).catch((error) =>
          setMessage(errorMessage(error)),
        )
    },
    [values],
  )

  /** A new value for a kind, or null while the word list loads or a username needs more input. */
  const generate = useCallback(
    (
      which: GeneratorKind,
      options: GeneratorOptions,
      current: GeneratorChoices,
    ): string | null => {
      if (which === "password") return generatePassword(options)
      if (!words) return null
      return which === "passphrase"
        ? generatePassphrase(current.passphrase, words)
        : generateUsername(current.username, words)
    },
    [words],
  )

  // A kind shown for the first time this session gets a value once it can be generated.
  useEffect(() => {
    if (!passwordOptions || !choices || values[kind] !== undefined) return
    const value = generate(kind, passwordOptions, choices)
    if (value !== null) show(kind, value, "now")
  }, [passwordOptions, choices, values, kind, generate, show])

  if (!passwordOptions || !choices) return null

  const updatePasswordOptions = (patch: Partial<GeneratorOptions>) => {
    const changed = { ...passwordOptions, ...patch }
    // The saved length follows the generated one, so the length controls show the length the password has.
    const next = { ...changed, length: passwordLength(changed) }
    setPasswordOptions(next)
    void generatorOptionsItem.setValue(next)
    show("password", generatePassword(next), "whenSettled")
  }
  const updateChoices = (next: GeneratorChoices, regenerate: boolean) => {
    setChoices(next)
    void generatorChoicesItem.setValue(next)
    if (regenerate)
      show(next.kind, generate(next.kind, passwordOptions, next), "whenSettled")
  }

  const generateForwardedAlias = async () => {
    setGeneratingAlias(true)
    try {
      const { alias } = await callBackground("generator.forwardedEmail", {
        service: choices.username.forwardingService,
        accountId: choices.username.forwardingAccountId || undefined,
      })
      const next = { ...values, username: alias }
      setValues(next)
      void generatedItem.setValue(next)
    } catch (error) {
      notifyError(error)
    } finally {
      setGeneratingAlias(false)
    }
  }

  return {
    kind,
    value: values[kind] ?? null,
    passwordOptions,
    choices,
    message,
    setMessage,
    generatingAlias,
    generateForwardedAlias,
    regenerate: () => {
      if (kind === "username" && choices.username.type === "forwarded") {
        void generateForwardedAlias()
        return
      }
      show(kind, generate(kind, passwordOptions, choices), "now")
    },
    chooseKind: (next: GeneratorKind) =>
      updateChoices({ ...choices, kind: next }, false),
    updatePasswordOptions,
    updatePassphrase: (patch: Partial<PassphraseOptions>) =>
      updateChoices(
        { ...choices, passphrase: { ...choices.passphrase, ...patch } },
        true,
      ),
    updateUsername: (patch: Partial<UsernameOptions>) => {
      const nextUsername = { ...choices.username, ...patch }
      // Never auto-call external forwarding APIs while the user is editing options.
      const shouldRegenerate = nextUsername.type !== "forwarded"
      updateChoices({ ...choices, username: nextUsername }, shouldRegenerate)
    },
  }
}

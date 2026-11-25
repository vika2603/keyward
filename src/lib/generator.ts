import { storage } from "wxt/utils/storage"

export interface GeneratorOptions {
  length: number
  upper: boolean
  lower: boolean
  digits: boolean
  symbols: boolean
  /** The symbol characters to draw from; spaces and repeats are ignored. */
  symbolSet: string
  /** The fewest digits a password has while digits are included. */
  minimumDigits: number
  /** The fewest symbols a password has while symbols are included. */
  minimumSymbols: number
  avoidAmbiguousCharacters: boolean
}

export const LENGTH_MIN = 5
export const LENGTH_MAX = 128
/** The largest minimum count of digits or of symbols; the smallest is 0. */
export const MINIMUM_COUNT_MAX = 9

export const defaultGeneratorOptions: GeneratorOptions = {
  length: 20,
  upper: true,
  lower: true,
  digits: true,
  symbols: true,
  symbolSet: "!@#$%^*-_=+?",
  minimumDigits: 1,
  minimumSymbols: 0,
  avoidAmbiguousCharacters: false,
}

/** Options saved by an older version lack the options added since, so read them with `getGeneratorOptions`. */
export const generatorOptionsItem = storage.defineItem<
  Partial<GeneratorOptions>
>("local:generatorOptions", { fallback: defaultGeneratorOptions })

/** The saved password options, with the default for each option the saved value lacks. */
export async function getGeneratorOptions(): Promise<GeneratorOptions> {
  return {
    ...defaultGeneratorOptions,
    ...(await generatorOptionsItem.getValue()),
  }
}

export type GeneratorKind = "password" | "passphrase" | "username"

export interface PassphraseOptions {
  words: number
  separator: string
  capitalize: boolean
  /** Appends one digit to one of the words. */
  includeNumber: boolean
}

export const WORDS_MIN = 3
export const WORDS_MAX = 20

export const defaultPassphraseOptions: PassphraseOptions = {
  words: 6,
  separator: "-",
  capitalize: false,
  includeNumber: false,
}

export type UsernameType = "word" | "plusEmail" | "catchAll"

export interface UsernameOptions {
  type: UsernameType
  capitalize: boolean
  /** Appends four digits to a random word. */
  includeNumber: boolean
  /** The address a plus-addressed username is made from. */
  email: string
  /** The domain whose catch-all mailbox receives a catch-all username. */
  domain: string
}

export const defaultUsernameOptions: UsernameOptions = {
  type: "word",
  capitalize: false,
  includeNumber: false,
  email: "",
  domain: "",
}

/** What the generator makes and how; password options keep their own item. */
export interface GeneratorChoices {
  kind: GeneratorKind
  passphrase: PassphraseOptions
  username: UsernameOptions
}

export const defaultGeneratorChoices: GeneratorChoices = {
  kind: "password",
  passphrase: defaultPassphraseOptions,
  username: defaultUsernameOptions,
}

export const generatorChoicesItem = storage.defineItem<GeneratorChoices>(
  "local:generatorChoices",
  { fallback: defaultGeneratorChoices },
)

/** The values the generator shows, per kind, kept for the browser session so that reopening it shows the same ones. */
export const generatedItem = storage.defineItem<
  Partial<Record<GeneratorKind, string>>
>("session:generator.shown", { fallback: {} })

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
const LOWER = "abcdefghijklmnopqrstuvwxyz"
const DIGITS = "0123456789"
// Avoiding ambiguous characters leaves out the same ones Bitwarden does: I, O, l, 0 and 1.
const AMBIGUOUS = /[IOl01]/g

/** A uniformly random integer in [0, n), without modulo bias. */
function randomIndex(n: number): number {
  const limit = Math.floor(0x1_0000_0000 / n) * n
  const buf = new Uint32Array(1)
  for (;;) {
    crypto.getRandomValues(buf)
    const value = buf[0] as number
    if (value < limit) return value % n
  }
}

function pick<T>(items: readonly T[]): T {
  return items[randomIndex(items.length)] as T
}

function clampedInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}

export function symbolChars(symbolSet: string): string[] {
  return [...new Set([...symbolSet.replace(/\s/g, "")])]
}

interface CharacterClass {
  characters: string[]
  /** How many characters of a password must come from this class. */
  required: number
}

/** The character classes the options enable; lowercase stands in when none is usable. */
function characterClasses(options: GeneratorOptions): CharacterClass[] {
  const builtIn = (characters: string) => [
    ...(options.avoidAmbiguousCharacters
      ? characters.replace(AMBIGUOUS, "")
      : characters),
  ]
  // An included class always has at least one character, even with a minimum of 0, as in Bitwarden.
  const atLeastOne = (minimum: number) =>
    Math.max(1, clampedInteger(minimum, 0, MINIMUM_COUNT_MAX))
  const classes: CharacterClass[] = []
  if (options.upper) classes.push({ characters: builtIn(UPPER), required: 1 })
  if (options.lower) classes.push({ characters: builtIn(LOWER), required: 1 })
  if (options.digits)
    classes.push({
      characters: builtIn(DIGITS),
      required: atLeastOne(options.minimumDigits),
    })
  const symbols = symbolChars(options.symbolSet)
  if (options.symbols && symbols.length)
    classes.push({
      characters: symbols,
      required: atLeastOne(options.minimumSymbols),
    })
  if (!classes.length) classes.push({ characters: builtIn(LOWER), required: 1 })
  return classes
}

/**
 * The length a password is generated at: the chosen length kept within range, raised when it is
 * too short for the required characters (one of each included class, or its minimum when higher).
 * Raising the length, as Bitwarden does, keeps every minimum met instead of dropping some.
 */
export function passwordLength(options: GeneratorOptions): number {
  const required = characterClasses(options).reduce(
    (sum, characterClass) => sum + characterClass.required,
    0,
  )
  return Math.max(
    required,
    clampedInteger(options.length, LENGTH_MIN, LENGTH_MAX),
  )
}

/** A password with the required characters of every enabled class, the rest drawn from all of them. */
export function generatePassword(options: GeneratorOptions): string {
  const classes = characterClasses(options)
  const pool = classes.flatMap((characterClass) => characterClass.characters)
  const chars = classes.flatMap(({ characters, required }) =>
    Array.from({ length: required }, () => pick(characters)),
  )
  const length = passwordLength(options)
  while (chars.length < length) chars.push(pick(pool))
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1)
    ;[chars[i], chars[j]] = [chars[j] as string, chars[i] as string]
  }
  return chars.join("")
}

let wordList: Promise<string[]> | null = null

/** The EFF long word list, loaded the first time a passphrase or word is generated. */
export function loadWords(): Promise<string[]> {
  wordList ??= import("diceware-wordlist-en-eff").then((module) =>
    Object.values(module.default),
  )
  return wordList
}

function capitalized(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/** Lowercase letters and digits, for the random part of an email username. */
const ADDRESS_CHARS = [..."abcdefghijklmnopqrstuvwxyz0123456789"]

function randomAddressPart(length: number): string {
  return Array.from({ length }, () => pick(ADDRESS_CHARS)).join("")
}

export function generatePassphrase(
  options: PassphraseOptions,
  words: readonly string[],
): string {
  const count = Math.min(
    WORDS_MAX,
    Math.max(WORDS_MIN, Math.round(options.words) || WORDS_MIN),
  )
  const parts = Array.from({ length: count }, () => {
    const word = pick(words)
    return options.capitalize ? capitalized(word) : word
  })
  if (options.includeNumber) {
    const index = randomIndex(parts.length)
    parts[index] = `${parts[index]}${randomIndex(10)}`
  }
  return parts.join(options.separator)
}

/** A username, or null when the chosen type needs an email address or a domain that is missing or invalid. */
export function generateUsername(
  options: UsernameOptions,
  words: readonly string[],
): string | null {
  switch (options.type) {
    case "word": {
      const word = pick(words)
      const base = options.capitalize ? capitalized(word) : word
      return options.includeNumber
        ? `${base}${String(randomIndex(10_000)).padStart(4, "0")}`
        : base
    }
    case "plusEmail": {
      // An existing "+tag" in the address is replaced.
      const match = options.email
        .trim()
        .match(/^([^@\s+]+)(?:\+[^@\s]*)?@([^@\s]+\.[^@\s]+)$/)
      return match ? `${match[1]}+${randomAddressPart(8)}@${match[2]}` : null
    }
    case "catchAll": {
      const domain = options.domain.trim().replace(/^@/, "")
      return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(domain)
        ? `${randomAddressPart(8)}@${domain}`
        : null
    }
  }
}

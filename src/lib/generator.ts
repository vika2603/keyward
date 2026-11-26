import { storage } from "wxt/utils/storage"
import { isHostName } from "./site"

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

export const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
export const LOWER = "abcdefghijklmnopqrstuvwxyz"
export const DIGITS = "0123456789"
/** The printable ASCII characters other than letters and digits; a space is left out. */
export const SPECIAL = String.fromCharCode(
  ...Array.from({ length: 0x7e - 0x21 + 1 }, (_, index) => 0x21 + index),
).replace(/[A-Za-z0-9]/g, "")
// Avoiding ambiguous characters leaves out the same ones Bitwarden does: I, O, l, 0 and 1.
const AMBIGUOUS = /[IOl01]/g
const AMBIGUOUS_CHARACTER = /^[IOl01]$/
/**
 * Tries at generating a password with no longer run of one character than a site allows. The
 * strictest sites in Apple's list allow runs of two among 60 or more characters, where a longer
 * run comes once in hundreds of passwords.
 */
const MAX_RUN_ATTEMPTS = 100

/** What a site or a page's field allows of a password, beyond the user's options. */
export interface PasswordLimits {
  minLength: number | null
  maxLength: number | null
  /** The most times one character may appear in a row. */
  maxConsecutive: number | null
  /** Sets of characters the password must have at least one character of each. */
  required: string[]
  /** Every character the password may have; null allows every character. */
  allowed: string | null
}

/** A uniformly random integer in [0, count), without modulo bias. */
function randomIndex(count: number): number {
  const limit = Math.floor(0x1_0000_0000 / count) * count
  const random = new Uint32Array(1)
  for (;;) {
    crypto.getRandomValues(random)
    const value = random[0] as number
    if (value < limit) return value % count
  }
}

function randomItem<T>(items: readonly T[]): T {
  return items[randomIndex(items.length)] as T
}

function clampedInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}

function symbolChars(symbolSet: string): string[] {
  return [...new Set([...symbolSet.replace(/\s/g, "")])]
}

interface CharacterClass {
  characters: string[]
  /** How many characters of a password must come from this class. */
  required: number
  /** Whether the class holds one of a site's required sets, so it keeps at least one character. */
  forSite?: boolean
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

/**
 * A password with the required characters of every enabled class, the rest drawn from all of them.
 * With `limits`, the options give way where a site or field needs it: see `classesWithin`.
 */
export function generatePassword(
  options: GeneratorOptions,
  limits?: PasswordLimits | null,
): string {
  if (!limits)
    return passwordFrom(characterClasses(options), passwordLength(options))
  // A page sets the limits, so the generator's own maximum still holds.
  const length = Math.min(
    LENGTH_MAX,
    limits.maxLength ?? LENGTH_MAX,
    Math.max(limits.minLength ?? 0, passwordLength(options)),
  )
  const classes = classesWithin(options, limits, length)
  let password = passwordFrom(classes, length)
  for (
    let attempt = 1;
    attempt < MAX_RUN_ATTEMPTS &&
    limits.maxConsecutive !== null &&
    longestRun(password) > limits.maxConsecutive;
    attempt++
  )
    password = passwordFrom(classes, length)
  return password
}

/**
 * The options' character classes within a site's limits: each keeps only the characters the site
 * allows, and each of the site's required sets that no class keeps to gets a class of its own,
 * with the user's symbols where the set has some. When the classes require more characters than
 * `length`, the minimums above one give way first, then the user's own classes, which still
 * lend their characters to the rest of the password.
 */
function classesWithin(
  options: GeneratorOptions,
  limits: PasswordLimits,
  length: number,
): CharacterClass[] {
  const allowed = limits.allowed === null ? null : new Set(limits.allowed)
  const isAllowed = (character: string) => !allowed || allowed.has(character)
  const unambiguous = (characters: string[]) => {
    const clear = characters.filter(
      (character) => !AMBIGUOUS_CHARACTER.test(character),
    )
    return options.avoidAmbiguousCharacters && clear.length ? clear : characters
  }
  const classes = characterClasses(options)
    .map((characterClass) => ({
      ...characterClass,
      characters: characterClass.characters.filter(isAllowed),
    }))
    .filter((characterClass) => characterClass.characters.length)
  const userSymbols = symbolChars(options.symbolSet)
  for (const set of limits.required) {
    const members = new Set(set)
    const holder = classes.find((characterClass) =>
      characterClass.characters.every((character) => members.has(character)),
    )
    if (holder) {
      holder.forSite = true
      continue
    }
    const candidates = [...members].filter(isAllowed)
    const preferred = candidates.filter(
      (character) =>
        !SPECIAL.includes(character) || userSymbols.includes(character),
    )
    const characters = unambiguous(preferred.length ? preferred : candidates)
    if (characters.length)
      classes.push({ characters, required: 1, forSite: true })
  }
  if (!classes.length)
    classes.push({
      characters: unambiguous([...(limits.allowed ?? LOWER)]),
      required: 1,
    })
  let excess =
    classes.reduce((sum, characterClass) => sum + characterClass.required, 0) -
    length
  for (const characterClass of classes)
    while (excess > 0 && characterClass.required > 1) {
      characterClass.required--
      excess--
    }
  for (const characterClass of classes)
    if (excess > 0 && !characterClass.forSite && characterClass.required) {
      characterClass.required = 0
      excess--
    }
  return classes
}

/** The length of the longest run of one character. */
function longestRun(password: string): number {
  let longest = 0
  let run = 0
  for (let index = 0; index < password.length; index++) {
    run = password[index] === password[index - 1] ? run + 1 : 1
    longest = Math.max(longest, run)
  }
  return longest
}

/** The classes' required characters, then characters from all of them up to `length`, shuffled. */
function passwordFrom(classes: CharacterClass[], length: number): string {
  const pool = classes.flatMap((characterClass) => characterClass.characters)
  const chars = classes.flatMap(({ characters, required }) =>
    Array.from({ length: required }, () => randomItem(characters)),
  )
  while (chars.length < length) chars.push(randomItem(pool))
  for (let last = chars.length - 1; last > 0; last--) {
    const other = randomIndex(last + 1)
    ;[chars[last], chars[other]] = [
      chars[other] as string,
      chars[last] as string,
    ]
  }
  return chars.join("")
}

let wordList: Promise<string[]> | null = null

/** The EFF long word list, loaded the first time a passphrase or word is generated. */
export function loadWords(): Promise<string[]> {
  wordList ??= import("diceware-wordlist-en-eff").then(
    (module) => Object.values(module.default),
    (error: unknown) => {
      wordList = null
      throw error
    },
  )
  return wordList
}

function capitalized(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/** Lowercase letters and digits, for the random part of an email username. */
const ADDRESS_CHARS = [..."abcdefghijklmnopqrstuvwxyz0123456789"]

function randomAddressPart(length: number): string {
  return Array.from({ length }, () => randomItem(ADDRESS_CHARS)).join("")
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
    const word = randomItem(words)
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
      const word = randomItem(words)
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
      return isHostName(domain) && domain.includes(".")
        ? `${randomAddressPart(8)}@${domain}`
        : null
    }
  }
}

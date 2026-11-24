import { storage } from "wxt/utils/storage"

export interface GeneratorOptions {
  length: number
  upper: boolean
  lower: boolean
  digits: boolean
  symbols: boolean
  /** The symbol characters to draw from; spaces and repeats are ignored. */
  symbolSet: string
}

export const LENGTH_MIN = 8
export const LENGTH_MAX = 64

export const defaultGeneratorOptions: GeneratorOptions = {
  length: 20,
  upper: true,
  lower: true,
  digits: true,
  symbols: true,
  symbolSet: "!@#$%^*-_=+?",
}

export const generatorOptionsItem = storage.defineItem<GeneratorOptions>(
  "local:generatorOptions",
  { fallback: defaultGeneratorOptions },
)

// Characters that are easy to confuse (l, I, O, 0, 1) are left out of the built-in sets.
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"
const LOWER = "abcdefghijkmnopqrstuvwxyz"
const DIGITS = "23456789"

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

export function symbolChars(symbolSet: string): string[] {
  return [...new Set([...symbolSet.replace(/\s/g, "")])]
}

/** The character sets the options enable; lowercase stands in when none is usable. */
export function characterSets(options: GeneratorOptions): string[][] {
  const sets: string[][] = []
  if (options.upper) sets.push([...UPPER])
  if (options.lower) sets.push([...LOWER])
  if (options.digits) sets.push([...DIGITS])
  const symbols = symbolChars(options.symbolSet)
  if (options.symbols && symbols.length) sets.push(symbols)
  if (!sets.length) sets.push([...LOWER])
  return sets
}

/** A password with at least one character from every enabled set, the rest from all of them. */
export function generatePassword(options: GeneratorOptions): string {
  const length = Math.min(
    LENGTH_MAX,
    Math.max(LENGTH_MIN, Math.round(options.length)),
  )
  const sets = characterSets(options)
  const pool = sets.flat()
  const chars = sets.map((set) => pick(set))
  while (chars.length < length) chars.push(pick(pool))
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1)
    ;[chars[i], chars[j]] = [chars[j] as string, chars[i] as string]
  }
  return chars.join("")
}

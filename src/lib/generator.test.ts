import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import {
  defaultGeneratorOptions,
  defaultPassphraseOptions,
  defaultUsernameOptions,
  type GeneratorOptions,
  generatePassphrase,
  generatePassword,
  generateUsername,
  getGeneratorOptions,
  LENGTH_MAX,
  LENGTH_MIN,
  loadWords,
  WORDS_MAX,
  WORDS_MIN,
} from "./generator"

const SYMBOL = /[!@#$%^*\-_=+?]/g

function count(password: string, pattern: RegExp): number {
  return password.match(pattern)?.length ?? 0
}

describe("generatePassword", () => {
  it("has the requested length within the allowed range", () => {
    expect(LENGTH_MIN).toBe(5)
    expect(LENGTH_MAX).toBe(128)
    expect(
      generatePassword({ ...defaultGeneratorOptions, length: 20 }),
    ).toHaveLength(20)
    expect(
      generatePassword({ ...defaultGeneratorOptions, length: 2 }),
    ).toHaveLength(LENGTH_MIN)
    expect(
      generatePassword({ ...defaultGeneratorOptions, length: 500 }),
    ).toHaveLength(LENGTH_MAX)
  })

  it("contains every enabled character class, even with a minimum of 0", () => {
    for (let round = 0; round < 200; round++) {
      const password = generatePassword({
        ...defaultGeneratorOptions,
        length: LENGTH_MIN,
        minimumDigits: 0,
        minimumSymbols: 0,
      })
      expect(password).toMatch(/[A-Z]/)
      expect(password).toMatch(/[a-z]/)
      expect(password).toMatch(/[0-9]/)
      expect(password).toMatch(SYMBOL)
    }
  })

  it("has at least the minimum numbers and special characters", () => {
    const options = {
      ...defaultGeneratorOptions,
      length: 12,
      minimumDigits: 4,
      minimumSymbols: 3,
    }
    for (let round = 0; round < 500; round++) {
      const password = generatePassword(options)
      expect(password).toHaveLength(12)
      expect(count(password, /[0-9]/g)).toBeGreaterThanOrEqual(4)
      expect(count(password, SYMBOL)).toBeGreaterThanOrEqual(3)
    }
  })

  it("grows a length too short for the required characters to fit them", () => {
    const options = {
      ...defaultGeneratorOptions,
      length: LENGTH_MIN,
      minimumDigits: 9,
      minimumSymbols: 9,
    }
    for (let round = 0; round < 100; round++) {
      const password = generatePassword(options)
      // One uppercase, one lowercase, nine digits and nine symbols.
      expect(password).toHaveLength(20)
      expect(password).toMatch(/[A-Z]/)
      expect(password).toMatch(/[a-z]/)
      expect(count(password, /[0-9]/g)).toBe(9)
      expect(count(password, SYMBOL)).toBe(9)
    }
  })

  it("ignores the minimum of a class that is left out", () => {
    const options = {
      ...defaultGeneratorOptions,
      length: LENGTH_MIN,
      digits: false,
      minimumDigits: 9,
    }
    for (let round = 0; round < 50; round++) {
      const password = generatePassword(options)
      expect(password).toHaveLength(LENGTH_MIN)
      expect(password).not.toMatch(/[0-9]/)
    }
  })

  it("leaves out ambiguous characters only when asked", () => {
    const passwords = (avoidAmbiguousCharacters: boolean) =>
      Array.from({ length: 50 }, () =>
        generatePassword({
          ...defaultGeneratorOptions,
          length: LENGTH_MAX,
          avoidAmbiguousCharacters,
        }),
      ).join("")
    expect(passwords(true)).not.toMatch(/[IOl01]/)
    const withAmbiguous = passwords(false)
    for (const character of "IOl01") expect(withAmbiguous).toContain(character)
  })

  it("draws symbols only from the configured set and leaves out disabled classes", () => {
    const options = {
      ...defaultGeneratorOptions,
      upper: false,
      lower: false,
      symbolSet: "& ~&",
    }
    for (let round = 0; round < 50; round++) {
      expect(generatePassword(options)).toMatch(/^[0-9&~]+$/)
    }
  })

  it("falls back to lowercase when no class is usable", () => {
    const options = {
      ...defaultGeneratorOptions,
      upper: false,
      lower: false,
      digits: false,
      symbolSet: " ",
    }
    expect(generatePassword(options)).toMatch(/^[a-z]+$/)
  })
})

describe("getGeneratorOptions", () => {
  beforeEach(() => fakeBrowser.reset())

  it("is the defaults when nothing is saved", async () => {
    expect(await getGeneratorOptions()).toEqual(defaultGeneratorOptions)
  })

  it("fills the options that older saved options lack with their defaults", async () => {
    const saved: Partial<GeneratorOptions> = {
      length: 8,
      upper: true,
      lower: false,
      digits: true,
      symbols: false,
      symbolSet: "!?",
    }
    await fakeBrowser.storage.local.set({ generatorOptions: saved })
    const options = await getGeneratorOptions()
    expect(options).toEqual({
      ...saved,
      minimumDigits: 1,
      minimumSymbols: 0,
      avoidAmbiguousCharacters: false,
    })
    expect(generatePassword(options)).toMatch(/^[A-Z0-9]{8}$/)
  })
})

const WORDS = ["alpha", "bravo", "charlie", "delta"]

describe("generatePassphrase", () => {
  it("joins the requested number of words, kept within range", () => {
    const options = { ...defaultPassphraseOptions, words: 5, separator: "_" }
    expect(generatePassphrase(options, WORDS).split("_")).toHaveLength(5)
    expect(
      generatePassphrase({ ...options, words: 1 }, WORDS).split("_"),
    ).toHaveLength(WORDS_MIN)
    expect(
      generatePassphrase({ ...options, words: 99 }, WORDS).split("_"),
    ).toHaveLength(WORDS_MAX)
  })

  it("capitalizes words and appends one digit when asked", () => {
    const parts = generatePassphrase(
      { words: 6, separator: "-", capitalize: true, includeNumber: true },
      WORDS,
    ).split("-")
    for (const part of parts) expect(part).toMatch(/^[A-Z][a-z]+\d?$/)
    expect(parts.filter((part) => /\d$/.test(part))).toHaveLength(1)
  })
})

describe("generateUsername", () => {
  it("makes a word, optionally capitalized with four digits", () => {
    expect(WORDS).toContain(generateUsername(defaultUsernameOptions, WORDS))
    expect(
      generateUsername(
        { ...defaultUsernameOptions, capitalize: true, includeNumber: true },
        WORDS,
      ),
    ).toMatch(/^[A-Z][a-z]+\d{4}$/)
  })

  it("adds a random tag to an email address, replacing an existing one", () => {
    const options = { ...defaultUsernameOptions, type: "plusEmail" as const }
    expect(
      generateUsername({ ...options, email: "me+old@example.com" }, WORDS),
    ).toMatch(/^me\+[a-z0-9]{8}@example\.com$/)
    expect(
      generateUsername({ ...options, email: "not an email" }, WORDS),
    ).toBeNull()
  })

  it("makes a random address at a catch-all domain", () => {
    const options = { ...defaultUsernameOptions, type: "catchAll" as const }
    expect(
      generateUsername({ ...options, domain: "@example.com" }, WORDS),
    ).toMatch(/^[a-z0-9]{8}@example\.com$/)
    expect(
      generateUsername({ ...options, domain: "example" }, WORDS),
    ).toBeNull()
  })
})

describe("loadWords", () => {
  it("loads the 7,776 distinct words of the EFF long list", async () => {
    const words = await loadWords()
    expect(words).toHaveLength(7776)
    expect(new Set(words).size).toBe(7776)
  })

  it("loads the list again after a load that failed", async () => {
    vi.resetModules()
    let loads = 0
    vi.doMock("diceware-wordlist-en-eff", () => {
      loads++
      if (loads === 1) throw new Error("The word list chunk failed to load")
      return { default: { "11111": "abacus", "11112": "abdomen" } }
    })
    try {
      const fresh = await import("./generator")
      await expect(fresh.loadWords()).rejects.toThrow()
      expect(await fresh.loadWords()).toEqual(["abacus", "abdomen"])
    } finally {
      vi.doUnmock("diceware-wordlist-en-eff")
      vi.resetModules()
    }
  })
})

import { describe, expect, it } from "vitest"
import {
  defaultGeneratorOptions,
  defaultPassphraseOptions,
  defaultUsernameOptions,
  generatePassphrase,
  generatePassword,
  generateUsername,
  LENGTH_MAX,
  LENGTH_MIN,
  loadWords,
  WORDS_MAX,
  WORDS_MIN,
} from "./generator"

describe("generatePassword", () => {
  it("has the requested length within the allowed range", () => {
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

  it("contains every enabled character class and no look-alike characters", () => {
    for (let i = 0; i < 200; i++) {
      const password = generatePassword({
        ...defaultGeneratorOptions,
        length: LENGTH_MIN,
      })
      expect(password).toMatch(/[A-Z]/)
      expect(password).toMatch(/[a-z]/)
      expect(password).toMatch(/[0-9]/)
      expect(password).toMatch(/[!@#$%^*\-_=+?]/)
      expect(password).not.toMatch(/[lIO01]/)
    }
  })

  it("draws symbols only from the configured set and leaves out disabled classes", () => {
    const options = {
      ...defaultGeneratorOptions,
      upper: false,
      lower: false,
      symbolSet: "& ~&",
    }
    for (let i = 0; i < 50; i++) {
      expect(generatePassword(options)).toMatch(/^[2-9&~]+$/)
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
})

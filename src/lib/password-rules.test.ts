import { describe, expect, it } from "vitest"
import {
  defaultGeneratorOptions,
  type GeneratorOptions,
  generatePassword,
} from "./generator"
import {
  parsePasswordRules,
  passwordLimitsFor,
  siteRulesFor,
} from "./password-rules"

/** Generates many passwords, as the checks below hold for every one and randomness hides misses. */
function many(
  options: GeneratorOptions,
  rules: string,
  check: (password: string) => void,
): void {
  const limits = parsePasswordRules(rules)
  for (let round = 0; round < 200; round++)
    check(generatePassword(options, limits))
}

describe("parsePasswordRules", () => {
  it("reads lengths, required and allowed classes, keeping the strictest of repeats", () => {
    expect(
      parsePasswordRules(
        "minlength: 6; minlength: 8; maxlength: 20; maxlength: 16; max-consecutive: 2; required: digit; allowed: lower;",
      ),
    ).toEqual({
      minLength: 8,
      maxLength: 16,
      maxConsecutive: 2,
      required: ["0123456789"],
      allowed: "0123456789abcdefghijklmnopqrstuvwxyz",
    })
  })

  it("reads a custom class that holds a `]`, a `;` and a `,`", () => {
    const limits = parsePasswordRules(
      `minlength: 8; required: digit; required: [- !"#$&'()*+,.:;<=>?@[^_\`{|}~]]; allowed: lower, upper;`,
    )
    expect(limits?.required[1]).toBe(`-!"#$&'()*+,.:;<=>?@[^_\`{|}~]`)
    expect(limits?.minLength).toBe(8)
  })

  it("is null for text it does not understand, and allows every character when no class is named", () => {
    expect(parsePasswordRules("")).toBeNull()
    expect(parsePasswordRules("strength: high")).toBeNull()
    expect(parsePasswordRules("maxlength: 12")?.allowed).toBeNull()
  })
})

describe("generatePassword within a site's rules", () => {
  it("keeps to the site's length and characters", () => {
    many(
      defaultGeneratorOptions,
      "minlength: 8; maxlength: 12; required: lower; required: upper; required: digit; allowed: [-_];",
      (password) => {
        expect(password.length).toBe(12)
        expect(password).toMatch(/^[a-zA-Z0-9_-]+$/)
        expect(password).toMatch(/[a-z]/)
        expect(password).toMatch(/[A-Z]/)
        expect(password).toMatch(/[0-9]/)
      },
    )
  })

  it("has a character of each required custom class, from the user's symbols where it can", () => {
    many(
      defaultGeneratorOptions,
      "minlength: 8; maxlength: 40; required: upper; required: [!#$%&*@^]; allowed: lower,digit;",
      (password) => {
        expect(password).toMatch(/[!#$%&*@^]/)
        expect(password).toMatch(/^[a-zA-Z0-9!#$%&*@^]+$/)
      },
    )
  })

  it("adds what the site requires even when the user turned it off, and leaves out what the user did", () => {
    const options = {
      ...defaultGeneratorOptions,
      symbols: false,
      digits: false,
    }
    many(
      options,
      "required: digit; allowed: upper, lower, special;",
      (password) => {
        expect(password).toMatch(/[0-9]/)
        expect(password).toMatch(/^[a-zA-Z0-9]+$/)
      },
    )
  })

  it("gives up the user's minimums before the site's maximum length", () => {
    const options = {
      ...defaultGeneratorOptions,
      length: 30,
      minimumDigits: 9,
      minimumSymbols: 9,
    }
    many(options, "maxlength: 6;", (password) => {
      expect(password).toHaveLength(6)
    })
  })

  it("has no longer run of one character than the site allows", () => {
    // Twelve characters over 40 places make runs of three common; sites with this limit allow more.
    many(
      { ...defaultGeneratorOptions, length: 40 },
      "required: digit; allowed: [ab]; max-consecutive: 2;",
      (password) => {
        expect(password).not.toMatch(/(.)\1\1/)
      },
    )
  })
})

describe("passwordLimitsFor", () => {
  it("takes Apple's rules for the site or a parent domain it lists", () => {
    expect(siteRulesFor("mail.163.com")).toBe(siteRulesFor("163.com"))
    expect(siteRulesFor("163.com")).toMatch(/maxlength: 16/)
    expect(siteRulesFor("example.com")).toBeNull()
    expect(passwordLimitsFor("163.com", null)).toMatchObject({
      minLength: 6,
      maxLength: 16,
    })
  })

  it("prefers the field's own rules, within the field's length limits", () => {
    const limits = passwordLimitsFor("163.com", {
      rules: "minlength: 10; required: digit;",
      minLength: null,
      maxLength: 12,
    })
    expect(limits).toMatchObject({
      minLength: 10,
      maxLength: 12,
      required: ["0123456789"],
    })
  })

  it("is null when neither the field nor the site limits anything", () => {
    expect(
      passwordLimitsFor("example.com", {
        rules: null,
        minLength: null,
        maxLength: null,
      }),
    ).toBeNull()
    expect(
      passwordLimitsFor("example.com", {
        rules: null,
        minLength: null,
        maxLength: 16,
      }),
    ).toMatchObject({ maxLength: 16, allowed: null })
  })
})

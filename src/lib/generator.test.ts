import { describe, expect, it } from "vitest"
import {
  defaultGeneratorOptions,
  generatePassword,
  LENGTH_MAX,
  LENGTH_MIN,
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

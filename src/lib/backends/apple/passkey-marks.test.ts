import { beforeEach, describe, expect, it } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { markPasskeyOnly, passkeyOnlyIds } from "./passkey-marks"

const id = (n: number) => JSON.stringify([`user-${n}`, "example.com"])

beforeEach(() => fakeBrowser.reset())

describe("passkey-only marks", () => {
  it("marks a login and clears the mark", async () => {
    await markPasskeyOnly(id(1), true)
    await markPasskeyOnly(id(2), true)
    expect([...(await passkeyOnlyIds())]).toEqual([id(1), id(2)])
    await markPasskeyOnly(id(1), false)
    expect([...(await passkeyOnlyIds())]).toEqual([id(2)])
  })

  it("keeps a mark once however often it is set", async () => {
    await markPasskeyOnly(id(1), true)
    await markPasskeyOnly(id(1), true)
    expect((await passkeyOnlyIds()).size).toBe(1)
  })

  it("drops the oldest marks beyond five hundred", async () => {
    for (let n = 0; n < 501; n++) await markPasskeyOnly(id(n), true)
    const marks = await passkeyOnlyIds()
    expect(marks.size).toBe(500)
    expect(marks.has(id(0))).toBe(false)
    expect(marks.has(id(500))).toBe(true)
  })
})

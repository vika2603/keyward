import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { generatePassphrase, WORDS_MAX } from "@/lib/generator"
import type { Sender } from "@/lib/messaging"
import type { BackgroundApi } from "./api"
import { copyText } from "./clipboard"
import { createHandlers } from "./handlers"
import {
  addHistory,
  clearHistory,
  HISTORY_LIMIT,
  listHistory,
  SETTLE_DELAY_MS,
} from "./history"
import { fakeProviders, pageModule } from "./test-support"

vi.mock("./page", async () => (await import("./test-support")).pageModule)
vi.mock("./clipboard", () => ({ copyText: vi.fn(async () => {}) }))

const handlers = createHandlers(fakeProviders([]).providers)
const popup = { kind: "popup" } as Sender

function request<Type extends keyof BackgroundApi>(
  type: Type,
  payload: BackgroundApi[Type]["payload"],
): Promise<BackgroundApi[Type]["result"]> {
  return Promise.resolve(handlers[type].handle(payload as never, popup))
}

beforeEach(async () => {
  fakeBrowser.reset()
  vi.clearAllMocks()
  await clearHistory()
  pageModule.activeTab.mockResolvedValue({
    id: 7,
    url: "https://example.com/signup",
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe("values the generator shows", () => {
  it("keeps only the value that stays shown, with its kind and the page's host", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    for (const value of ["first-value", "second-value", "settled-value"]) {
      await request("generator.shown", { value, kind: "passphrase" })
      await vi.advanceTimersByTimeAsync(SETTLE_DELAY_MS / 2)
    }
    expect(await listHistory()).toEqual([])

    await vi.advanceTimersByTimeAsync(SETTLE_DELAY_MS)
    await vi.waitFor(async () => expect(await listHistory()).toHaveLength(1))
    expect(await listHistory()).toMatchObject([
      { value: "settled-value", kind: "passphrase", host: "example.com" },
    ])
  })

  it("keeps a value copied before it settles, once", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    await request("generator.shown", { value: "copied-name", kind: "username" })
    await request("generator.shown", {
      value: "copied-name",
      kind: "username",
      copied: true,
    })
    await request("generator.shown", { value: "later-name", kind: "username" })
    expect(await listHistory()).toMatchObject([
      { value: "copied-name", kind: "username" },
    ])

    await vi.advanceTimersByTimeAsync(SETTLE_DELAY_MS)
    await vi.waitFor(async () => expect(await listHistory()).toHaveLength(2))
    expect((await listHistory()).map((entry) => entry.value)).toEqual([
      "later-name",
      "copied-name",
    ])
  })

  it("lists a value that has not settled yet when the history opens", async () => {
    await request("generator.shown", { value: "just-shown", kind: "password" })
    expect(await request("history.list", null)).toMatchObject([
      { value: "just-shown", kind: "password" },
    ])
  })

  it("copies and keeps a passphrase of the most and longest words", async () => {
    const passphrase = generatePassphrase(
      {
        words: WORDS_MAX,
        separator: "-",
        capitalize: true,
        includeNumber: true,
      },
      ["ninelongs"],
    )
    await request("generator.shown", {
      value: passphrase,
      kind: "passphrase",
      copied: true,
    })
    await request("generator.copy", { password: passphrase })
    expect(copyText).toHaveBeenCalledWith(passphrase, true)
    expect(await listHistory()).toMatchObject([
      { value: passphrase, kind: "passphrase" },
    ])
  })
})

describe("the history", () => {
  it("reads entries stored without a kind as passwords", async () => {
    await fakeBrowser.storage.session.set({
      "generator.history": [
        { id: "old", password: "old-password", host: "example.com", at: 1 },
      ],
    })
    expect(await listHistory()).toEqual([
      {
        id: "old",
        value: "old-password",
        kind: "password",
        host: "example.com",
        at: 1,
      },
    ])
  })

  it("keeps every value added at the same time", async () => {
    const values = ["first-value", "second-value", "third-value"]
    await Promise.all(values.map((value) => addHistory(value, null)))
    expect((await listHistory()).map((entry) => entry.value)).toEqual(
      [...values].reverse(),
    )
  })

  it("keeps the newest entries up to the limit", async () => {
    for (let index = 1; index <= 105; index++) {
      await addHistory(`password-${index}`, null)
    }
    const values = (await listHistory()).map((entry) => entry.value)
    expect(values).toHaveLength(HISTORY_LIMIT)
    expect(values[0]).toBe("password-105")
    expect(values.at(-1)).toBe("password-6")
  })

  it("copies a username without clearing it from the clipboard later", async () => {
    await addHistory("generated-name", null, "username")
    await addHistory("generated-passphrase", null, "passphrase")
    await addHistory("generated-password", null, "password")
    for (const entry of await listHistory()) {
      await request("history.copy", { id: entry.id })
    }
    expect(vi.mocked(copyText).mock.calls).toEqual([
      ["generated-password", true],
      ["generated-passphrase", true],
      ["generated-name", false],
    ])
  })
})

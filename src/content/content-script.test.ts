// @vitest-environment happy-dom
// @vitest-environment-options {"settings": {"enableIframePageLoading": true, "navigation": {"disableChildFrameNavigation": true}}}
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import type { ContentScriptContext } from "wxt/utils/content-script-context"
import type { ContentMessage } from "@/background/api"
import {
  countDocumentWalks,
  startContentScript,
  stubLayout,
  trusted,
} from "./test-support"

const SIGN_IN = `
  <form>
    <input name="username">
    <input type="password" name="password">
    <button>Sign in</button>
  </form>`

/** Longer than the wait after a page change and shorter than the regular rescan. */
const SETTLE_MS = 500

let ctx: ContentScriptContext | undefined

beforeEach(() => {
  fakeBrowser.reset()
  vi.useFakeTimers()
  stubLayout()
})

afterEach(() => {
  ctx?.abort()
  ctx = undefined
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.head.innerHTML = ""
  document.body.innerHTML = ""
})

function input(selector: string): HTMLInputElement {
  const found = document.querySelector<HTMLInputElement>(selector)
  if (!found) throw new Error(`No ${selector} in the page`)
  return found
}

function focusByUser(field: HTMLInputElement): void {
  field.dispatchEvent(
    trusted(new FocusEvent("focusin", { bubbles: true, composed: true })),
  )
}

describe("watching the page for fields", () => {
  it("does not scan again for the field icons it adds", async () => {
    document.body.innerHTML = SIGN_IN
    const walks = countDocumentWalks()
    ;({ ctx } = await startContentScript())
    const walksOfFirstScan = walks()
    expect(document.querySelector("keyward-field-icons")).not.toBeNull()

    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    expect(walks()).toBe(walksOfFirstScan)
  })

  it("does not scan again while its menu opens, moves and grows", async () => {
    document.body.innerHTML = SIGN_IN
    const page = await startContentScript()
    ctx = page.ctx
    const walks = countDocumentWalks()

    focusByUser(input("[name=username]"))
    await vi.advanceTimersByTimeAsync(0)
    expect(document.querySelector("iframe")).not.toBeNull()
    await page.send({ type: "menu.resize", height: 120 })
    window.dispatchEvent(new Event("scroll"))
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    expect(walks()).toBe(0)

    document.querySelector("form")?.append(document.createElement("input"))
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    expect(walks()).toBeGreaterThan(0)
  })
})

describe("placing the field icons", () => {
  /** The layout reads of the page's inputs while the icons are placed after a resize. */
  async function inputLayoutReadsOnResize(): Promise<number> {
    const reads = vi.mocked(HTMLElement.prototype.getBoundingClientRect)
    reads.mockClear()
    window.dispatchEvent(new Event("resize"))
    await vi.advanceTimersByTimeAsync(100)
    return reads.mock.contexts.filter(
      (element) => element instanceof HTMLInputElement,
    ).length
  }

  it("reads no layout for the fields that are not in use", async () => {
    document.body.innerHTML = SIGN_IN + SIGN_IN
    ;({ ctx } = await startContentScript({ config: { menuTrigger: "click" } }))
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    expect(await inputLayoutReadsOnResize()).toBe(0)

    input("[name=password]").focus()
    expect(await inputLayoutReadsOnResize()).toBeGreaterThan(0)
  })
})

const OTHER_ORIGIN = "https://other.example"

type FillMessage = Extract<ContentMessage, { type: "fill" }>

const TWO_SIGN_INS = `
  <form>
    <input name="first-username">
    <input type="password" name="first-password">
  </form>
  <form>
    <input name="second-username">
    <input type="password" name="second-password">
  </form>`

const SIGN_UP = `
  <form>
    <input type="email" name="email">
    <input type="password" name="password" autocomplete="new-password">
    <input type="password" name="confirm" autocomplete="new-password">
  </form>`

const CODE_BOXES = `
  <form>
    ${Array.from(
      { length: 6 },
      (_, index) =>
        `<input name="digit-${index}" maxlength="1" autocomplete="one-time-code">`,
    ).join("")}
  </form>`

/** The values of the page's fields that have one, by field name. */
function filled(): Record<string, string> {
  return Object.fromEntries(
    [...document.querySelectorAll("input")]
      .filter((field) => field.value)
      .map((field) => [field.name, field.value]),
  )
}

function menuIsOpen(): boolean {
  return document.querySelector("iframe") !== null
}

async function openMenuOn(field: HTMLInputElement): Promise<void> {
  focusByUser(field)
  await vi.advanceTimersByTimeAsync(0)
  expect(menuIsOpen()).toBe(true)
}

function login(origin = location.origin): FillMessage {
  return {
    type: "fill",
    origin,
    username: "user@example.com",
    password: "{{SECRET_xbfqywla}}",
    fields: [],
    autoSubmit: false,
  }
}

describe("filling a login", () => {
  it("does nothing for a frame that is now at another origin, not even close the menu", async () => {
    document.body.innerHTML = TWO_SIGN_INS
    const page = await startContentScript()
    ctx = page.ctx
    await openMenuOn(input("[name=second-username]"))

    await page.send(login(OTHER_ORIGIN))
    expect(filled()).toEqual({})
    expect(menuIsOpen()).toBe(true)
  })

  it("fills the form whose field has the menu, and closes the menu", async () => {
    document.body.innerHTML = TWO_SIGN_INS
    const page = await startContentScript()
    ctx = page.ctx
    await openMenuOn(input("[name=second-username]"))

    await page.send(login())
    expect(filled()).toEqual({
      "second-username": "user@example.com",
      "second-password": "{{SECRET_xbfqywla}}",
    })
    expect(menuIsOpen()).toBe(false)
  })

  it("fills the menu's form even when another field has the focus", async () => {
    document.body.innerHTML = TWO_SIGN_INS
    const page = await startContentScript()
    ctx = page.ctx
    await openMenuOn(input("[name=second-username]"))
    input("[name=first-password]").focus()

    await page.send(login())
    expect(filled()).toEqual({
      "second-username": "user@example.com",
      "second-password": "{{SECRET_xbfqywla}}",
    })
  })

  it("fills the form last used after its menu closed and the field lost the focus", async () => {
    document.body.innerHTML = TWO_SIGN_INS
    const page = await startContentScript()
    ctx = page.ctx
    await openMenuOn(input("[name=second-username]"))
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    input("[name=second-username]").blur()
    expect(menuIsOpen()).toBe(false)

    await page.send(login())
    expect(filled()).toEqual({
      "second-username": "user@example.com",
      "second-password": "{{SECRET_xbfqywla}}",
    })
  })

  it("fills the focused field's form while no menu is open", async () => {
    document.body.innerHTML = TWO_SIGN_INS
    const page = await startContentScript({ config: { menuTrigger: "click" } })
    ctx = page.ctx
    input("[name=second-password]").focus()

    await page.send(login())
    expect(filled()).toEqual({
      "second-username": "user@example.com",
      "second-password": "{{SECRET_xbfqywla}}",
    })
  })

  it("fills the first form with a password when no field was used", async () => {
    document.body.innerHTML = TWO_SIGN_INS
    const page = await startContentScript()
    ctx = page.ctx

    await page.send(login())
    expect(filled()).toEqual({
      "first-username": "user@example.com",
      "first-password": "{{SECRET_xbfqywla}}",
    })
  })

  it("submits the form when the login asks for it", async () => {
    document.body.innerHTML = SIGN_IN
    const page = await startContentScript()
    ctx = page.ctx
    const submitted = vi.fn((event: Event) => event.preventDefault())
    document.addEventListener("submit", submitted)

    await page.send({ ...login(), autoSubmit: true })
    expect(submitted).toHaveBeenCalledOnce()
  })
})

describe("filling a one-time code", () => {
  it("does nothing for a frame that is now at another origin", async () => {
    document.body.innerHTML = CODE_BOXES
    const page = await startContentScript({ hasCodes: true })
    ctx = page.ctx
    await vi.advanceTimersByTimeAsync(0)
    await openMenuOn(input("[name=digit-0]"))

    await page.send({ type: "fillCode", origin: OTHER_ORIGIN, code: "123456" })
    expect(filled()).toEqual({})
    expect(menuIsOpen()).toBe(true)
  })

  it("fills the boxes of the menu's field", async () => {
    document.body.innerHTML = CODE_BOXES
    const page = await startContentScript({ hasCodes: true })
    ctx = page.ctx
    await vi.advanceTimersByTimeAsync(0)
    await openMenuOn(input("[name=digit-0]"))

    await page.send({
      type: "fillCode",
      origin: location.origin,
      code: "123456",
    })
    expect(Object.values(filled())).toEqual(["1", "2", "3", "4", "5", "6"])
  })

  it("does not fill a field that does not take a code", async () => {
    document.body.innerHTML = SIGN_IN
    const page = await startContentScript({ hasCodes: true })
    ctx = page.ctx
    input("[name=password]").focus()

    await page.send({
      type: "fillCode",
      origin: location.origin,
      code: "123456",
    })
    expect(filled()).toEqual({})
  })
})

describe("filling a generated password", () => {
  const generated = (origin = location.origin) =>
    ({ type: "fillNew", origin, password: "{{SECRET_0rjx6wrn}}" }) as const

  it("fills nothing for a frame that is now at another origin", async () => {
    document.body.innerHTML = SIGN_UP
    const page = await startContentScript()
    ctx = page.ctx
    await openMenuOn(input("[name=password]"))

    expect(await page.send(generated(OTHER_ORIGIN))).toBe(false)
    expect(filled()).toEqual({})
    expect(menuIsOpen()).toBe(true)
  })

  it("fills the menu's field and its confirmation", async () => {
    document.body.innerHTML = SIGN_UP
    const page = await startContentScript()
    ctx = page.ctx
    await openMenuOn(input("[name=password]"))

    expect(await page.send(generated())).toBe(true)
    expect(filled()).toEqual({
      password: "{{SECRET_0rjx6wrn}}",
      confirm: "{{SECRET_0rjx6wrn}}",
    })
  })

  it("fills the menu's form even when a sign-in field has the focus", async () => {
    document.body.innerHTML = SIGN_UP + SIGN_IN
    const page = await startContentScript()
    ctx = page.ctx
    await openMenuOn(input("[name=password][autocomplete=new-password]"))
    input("[name=password]:not([autocomplete])").focus()

    expect(await page.send(generated())).toBe(true)
    expect(filled()).toEqual({
      password: "{{SECRET_0rjx6wrn}}",
      confirm: "{{SECRET_0rjx6wrn}}",
    })
    expect(input("[name=password]:not([autocomplete])").value).toBe("")
  })

  it("fills a focused sign-in password field alone", async () => {
    document.body.innerHTML = SIGN_IN
    const page = await startContentScript({ config: { menuTrigger: "click" } })
    ctx = page.ctx
    input("[name=password]").focus()

    expect(await page.send(generated())).toBe(true)
    expect(filled()).toEqual({ password: "{{SECRET_0rjx6wrn}}" })
  })

  it("passes from a focused email field to its form's new password fields", async () => {
    document.body.innerHTML = SIGN_UP
    const page = await startContentScript({ config: { menuTrigger: "click" } })
    ctx = page.ctx
    input("[name=email]").focus()

    expect(await page.send(generated())).toBe(true)
    expect(filled()).toEqual({
      password: "{{SECRET_0rjx6wrn}}",
      confirm: "{{SECRET_0rjx6wrn}}",
    })
  })

  it("reports that no field took it when no field was used", async () => {
    document.body.innerHTML = SIGN_UP
    const page = await startContentScript()
    ctx = page.ctx

    expect(await page.send(generated())).toBe(false)
    expect(filled()).toEqual({})
  })
})

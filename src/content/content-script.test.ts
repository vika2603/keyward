// @vitest-environment happy-dom
// @vitest-environment-options {"settings": {"enableIframePageLoading": true, "navigation": {"disableChildFrameNavigation": true}}}
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import type { ContentScriptContext } from "wxt/utils/content-script-context"
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

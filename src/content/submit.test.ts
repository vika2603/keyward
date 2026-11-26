// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { submitControlOf } from "./submit"

afterEach(() => {
  document.body.innerHTML = ""
})

/** The control a click on the element with `id` presses, by its id. */
function pressed(id: string): string | null {
  const target = document.getElementById(id)
  if (!target) throw new Error(`No element ${id}`)
  return submitControlOf(target)?.id ?? null
}

describe("the control a click submits with", () => {
  it("is a submit button, or a plain button or input whose label sends a sign-in or sign-up", () => {
    document.body.innerHTML = `
      <button id="submit"><span id="inside">Go</span></button>
      <button id="create" type="button">Create account</button>
      <input id="sign-in" type="button" value=" Sign in ">
      <input id="register" type="button" value="注册">`
    expect(pressed("inside")).toBe("submit")
    expect(pressed("create")).toBe("create")
    expect(pressed("sign-in")).toBe("sign-in")
    expect(pressed("register")).toBe("register")
  })

  it("is a link or styled element a page turns into a button, with a short label", () => {
    document.body.innerHTML = `
      <a id="link" class="btn btn-primary"><span id="link-text">Create Account</span></a>
      <a id="script-link" href="#">Log in</a>
      <div id="block" class="button-row">Log in to see your orders and the deals picked for you</div>`
    expect(pressed("link-text")).toBe("link")
    expect(pressed("script-link")).toBe("script-link")
    expect(pressed("block")).toBeNull()
  })

  it("is not a button that does something else", () => {
    document.body.innerHTML = `
      <button id="show" type="button">Show password</button>
      <a id="help" href="/help" class="btn">Help</a>`
    expect(pressed("show")).toBeNull()
    expect(pressed("help")).toBeNull()
  })
})

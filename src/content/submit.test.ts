// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { ContentScriptContext } from "wxt/utils/content-script-context"
import { isSignInRequest, submitControlOf, watchSubmissions } from "./submit"
import type { SubmittedLogin } from "./submitted-login"
import { stubLayout } from "./test-support"

let ctx: ContentScriptContext | undefined

afterEach(() => {
  ctx?.abort()
  ctx = undefined
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
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

/** A resource entry as the browser records a request the page sent. */
function request(initiatorType: string, path: string): PerformanceEntry {
  return {
    initiatorType,
    name: `https://example.com${path}`,
  } as unknown as PerformanceEntry
}

describe("a sign-in a script sends", () => {
  /** Watches the page for submissions; returns what it reports and a way to deliver requests. */
  function watch() {
    stubLayout()
    let deliver: (entries: PerformanceEntry[]) => void = () => {}
    vi.stubGlobal(
      "PerformanceObserver",
      class {
        constructor(
          callback: (list: { getEntries(): PerformanceEntry[] }) => void,
        ) {
          deliver = (entries) => callback({ getEntries: () => entries })
        }
        observe() {}
        disconnect() {}
      },
    )
    const reports: SubmittedLogin[] = []
    ctx = new ContentScriptContext("content")
    watchSubmissions(
      ctx,
      () => true,
      (login) => reports.push(login),
    )
    return {
      reports,
      deliver: (...entries: PerformanceEntry[]) => deliver(entries),
    }
  }

  function signInForm(): void {
    document.body.innerHTML = `
      <form>
        <input name="username" value="someone">
        <input type="password" name="password" value="typed-password">
        <div class="sign-in-box">Continue to your account</div>
      </form>
      <input name="search">`
  }

  it("is told by its path and by being a fetch or XHR request", () => {
    expect(isSignInRequest(request("fetch", "/api/session/login"))).toBe(true)
    expect(isSignInRequest(request("xmlhttprequest", "/users/sign_in"))).toBe(
      true,
    )
    expect(isSignInRequest(request("img", "/login.png"))).toBe(false)
    expect(isSignInRequest(request("fetch", "/api/profile"))).toBe(false)
  })

  it("reports the form with the filled password once the user has left it", () => {
    signInForm()
    const { reports, deliver } = watch()
    document.querySelector<HTMLInputElement>("[name=search]")?.focus()
    deliver(request("fetch", "/api/profile"))
    expect(reports).toEqual([])
    deliver(request("fetch", "/api/session/login"))
    expect(reports).toEqual([
      { username: "someone", password: "typed-password", newPassword: false },
    ])
  })

  it("waits while the focus is still in a field of the form", () => {
    signInForm()
    const { reports, deliver } = watch()
    document.querySelector<HTMLInputElement>("[name=password]")?.focus()
    deliver(request("xmlhttprequest", "/login"))
    expect(reports).toEqual([])
  })
})

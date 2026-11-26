// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { ContentScriptContext } from "wxt/utils/content-script-context"
import { PageEvents } from "./page-events"
import { isSignInRequest, submitControlOf, watchSubmissions } from "./submit"
import type { SubmittedLogin } from "./submitted-login"
import { stubLayout, trusted } from "./test-support"

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

  it("is a button labelled in another language", () => {
    document.body.innerHTML = `
      <button id="russian" type="button">Войти</button>
      <input id="japanese" type="button" value="ログインする">
      <div id="german" role="button">Anmelden</div>
      <a id="spanish" href="#">Iniciar sesión</a>
      <button id="other" type="button">Weitere Optionen</button>`
    expect(pressed("russian")).toBe("russian")
    expect(pressed("japanese")).toBe("japanese")
    expect(pressed("german")).toBe("german")
    expect(pressed("spanish")).toBe("spanish")
    expect(pressed("other")).toBeNull()
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

  it("is not a link that offers help with signing in or leads to signing up", () => {
    document.body.innerHTML = `
      <a id="cannot" href="#">Can't log in?</a>
      <a id="help" class="btn-link" href="#">Need help signing in</a>
      <a id="sign-up" href="javascript:void(0)">Not registered? Sign up</a>`
    expect(pressed("cannot")).toBeNull()
    expect(pressed("help")).toBeNull()
    expect(pressed("sign-up")).toBeNull()
  })
})

/** A resource entry as the browser records a request the page sent, started at `startTime`. */
function request(
  initiatorType: string,
  path: string,
  startTime = 0,
): PerformanceEntry {
  return {
    initiatorType,
    name: `https://example.com${path}`,
    startTime,
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
      new PageEvents(ctx),
      () => true,
      (login) => reports.push(login),
    )
    return {
      reports,
      deliver: (...entries: PerformanceEntry[]) => deliver(entries),
    }
  }

  /** A filled sign-in form whose button shows only an arrow. */
  function signInForm(): void {
    document.body.innerHTML = `
      <form>
        <input name="username" value="someone">
        <input type="password" name="password" value="typed-password">
        <span id="go" class="icon-button">→</span>
      </form>`
  }

  /** Presses the form's button as the user would; returns when. */
  function press(): number {
    const pressedAt = performance.now()
    document
      .getElementById("go")
      ?.dispatchEvent(trusted(new MouseEvent("click", { bubbles: true })))
    return pressedAt
  }

  const typed = {
    username: "someone",
    password: "typed-password",
    newPassword: false,
  }

  it("is told by its path and by being a fetch or XHR request", () => {
    expect(isSignInRequest(request("fetch", "/api/session/login"))).toBe(true)
    expect(isSignInRequest(request("xmlhttprequest", "/users/sign_in"))).toBe(
      true,
    )
    expect(isSignInRequest(request("img", "/login.png"))).toBe(false)
    expect(isSignInRequest(request("fetch", "/api/profile"))).toBe(false)
  })

  it("reports the form when it starts right after the user pressed a control", () => {
    signInForm()
    const { reports, deliver } = watch()
    const pressedAt = press()
    deliver(request("fetch", "/api/profile", pressedAt + 100))
    expect(reports).toEqual([])
    deliver(request("fetch", "/api/session/login", pressedAt + 100))
    expect(reports).toEqual([typed])
  })

  it("is passed over when no press came just before it, or the page polls its path", () => {
    signInForm()
    const { reports, deliver } = watch()
    deliver(request("fetch", "/api/session/login"))
    const pressedAt = press()
    deliver(request("fetch", "/qrcode/login/poll", pressedAt - 1000))
    deliver(request("fetch", "/qrcode/login/poll", pressedAt + 100))
    deliver(request("fetch", "/users/sign_in", pressedAt + 3000))
    expect(reports).toEqual([])
    deliver(request("fetch", "/api/account/login", pressedAt + 200))
    expect(reports).toEqual([typed])
  })
})

// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { formOf, hasIterableFormElements, scopeOf } from "./deep-dom"
import { fillTargets, findFields, isOccluded, isVisible } from "./field-finder"
import {
  elementIdentifierOf,
  fillCustomFields,
  setFieldValue,
} from "./fill-dom"
import { type SiteFixRule, siteFixesFor } from "./site-fixes"
import { stubLayout } from "./test-support"

function requireInput(selector: string): HTMLInputElement {
  const found = document.querySelector<HTMLInputElement>(selector)
  if (!found) throw new Error(`Missing input ${selector}`)
  return found
}

function requireElement(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector)
  if (!found) throw new Error(`Missing element ${selector}`)
  return found
}

beforeEach(stubLayout)

afterEach(() => {
  vi.restoreAllMocks()
  document.head.innerHTML = ""
  document.body.innerHTML = ""
})

describe("declarative site fixes", () => {
  it("applies domain and urlPattern rules and falls back to heuristics when selectors miss", () => {
    const rules: SiteFixRule[] = [
      {
        domain: "example.com",
        urlPattern: "^/custom-signin",
        inputTypeSettings: {
          'input[data-custom="acct"]': "username",
          'input[name="ignored"]': "unknown",
        },
        formTypeSettings: {
          ".forced-signup": "signup",
        },
        formBoundarySelector: ".boundary",
      },
    ]
    const active = siteFixesFor(
      {
        hostname: "login.example.com",
        pathname: "/custom-signin",
        search: "",
      },
      rules,
    )
    document.body.innerHTML = `
      <div class="boundary">
        <input data-custom="acct" name="opaque">
        <input name="ignored" autocomplete="username">
      </div>
      <div class="forced-signup">
        <input type="password" name="pw">
      </div>`
    const found = findFields(document, undefined, active)
    expect(found.login.map((field) => field.name)).toEqual(["opaque"])
    expect(found.newPassword.map((field) => field.name)).toEqual(["pw"])

    // When a redesigned page no longer matches any rule selector, heuristics still work.
    document.body.innerHTML = `
      <form>
        <input type="email" name="email">
        <input type="password" name="password">
        <button>Sign in</button>
      </form>`
    const fallback = findFields(document, undefined, active)
    expect(new Set(fallback.login.map((field) => field.name))).toEqual(
      new Set(["email", "password"]),
    )
  })

  it("disables scanning when failsafeSettings sets maxInputsPerPage to 0", () => {
    const active = siteFixesFor(
      { hostname: "app.roll20.net", pathname: "/editor", search: "" },
      [{ domain: "roll20.net", failsafeSettings: { maxInputsPerPage: 0 } }],
    )
    document.body.innerHTML = `
      <form>
        <input name="email" type="email">
        <input name="password" type="password">
      </form>`
    const found = findFields(document, undefined, active)
    expect(found).toEqual({ login: [], newPassword: [], code: [] })
  })
})

describe("DOM recognition edge cases", () => {
  it("ignores a full-page wrapper form and narrows scope to the local login container", () => {
    const filler = "<div><span>item</span></div>".repeat(60)
    document.body.innerHTML = `
      <form id="aspnetForm">
        <header><nav><input type="text" name="site_search" placeholder="Search"></nav></header>
        <main>
          ${filler}
          <div class="login-box">
            <input type="text" name="member_id">
            <input type="password" name="pass">
            <button type="submit">Sign in</button>
          </div>
        </main>
      </form>`
    const password = requireInput("[name=pass]")
    const member = requireInput("[name=member_id]")
    expect(formOf(password)).toBeNull()
    expect(scopeOf(password)).toBe(document.querySelector(".login-box"))
    expect(fillTargets(password).username).toBe(member)
  })

  it("detects when a named input shadows form.elements", () => {
    document.body.innerHTML = `
      <form id="normal"><input name="user"></form>
      <form id="clobbered"><input name="elements"></form>`
    const normal = document.getElementById("normal") as HTMLFormElement
    const clobbered = document.getElementById("clobbered") as HTMLFormElement
    expect(hasIterableFormElements(normal)).toBe(true)
    Object.defineProperty(clobbered, "elements", {
      value: clobbered.querySelector("input"),
      configurable: true,
    })
    expect(hasIterableFormElements(clobbered)).toBe(false)
  })

  it("ignores an aria-label that merely mirrors the field's own value", () => {
    document.body.innerHTML = `
      <form>
        <input type="text" name="task" aria-label="Login screen redesign" value="Login screen redesign">
      </form>`
    const found = findFields(document)
    expect(found.login).toEqual([])
  })

  it("flips outbound navigation links when the submit button is generic", () => {
    document.body.innerHTML = `
      <form>
        <input type="email" name="email">
        <input type="password" name="password">
        <button type="submit">Continue</button>
        <a href="/login">Already have an account? Sign in</a>
      </form>`
    expect(findFields(document).newPassword.map((field) => field.name)).toEqual(
      ["password"],
    )

    document.body.innerHTML = `
      <form>
        <input type="email" name="email">
        <input type="password" name="password">
        <button type="submit">Continue</button>
        <a href="/signup">Create an account</a>
      </form>`
    expect(findFields(document).newPassword).toEqual([])
  })

  it("treats clipped elements, faded ancestors and occluded fields as hidden or blocked", () => {
    document.body.innerHTML = `
      <form>
        <input name="clipped" style="clip-path: inset(100%)">
        <input name="legacy-clipped" style="clip: rect(0px, 0px, 0px, 0px)">
        <div style="opacity: 0"><input name="faded-ancestor"></div>
        <input name="visible" type="text">
        <div id="cover"></div>
      </form>`
    const byName = (name: string) => requireInput(`[name=${name}]`)
    expect(isVisible(byName("clipped"))).toBe(false)
    expect(isVisible(byName("legacy-clipped"))).toBe(false)
    expect(isVisible(byName("faded-ancestor"))).toBe(false)
    expect(isVisible(byName("visible"))).toBe(true)

    const cover = requireElement("#cover")
    Object.defineProperty(document, "elementFromPoint", {
      value: () => cover,
      configurable: true,
    })
    expect(isOccluded(byName("visible"))).toBe(true)
    Object.defineProperty(document, "elementFromPoint", {
      value: () => byName("visible"),
      configurable: true,
    })
    expect(isOccluded(byName("visible"))).toBe(false)
  })

  it("never pairs a username field with a new-password field when filling a saved login", () => {
    document.body.innerHTML = `
      <form>
        <input type="email" name="email">
        <input type="password" name="new-pw" autocomplete="new-password">
      </form>`
    const email = requireInput("[name=email]")
    expect(fillTargets(email)).toEqual({ username: email, password: null })
  })
})

describe("filling and custom fields", () => {
  it("dispatches keyboard/input/change events and re-applies if a listener resets the value", () => {
    document.body.innerHTML = `<input name="user">`
    const input = requireInput("[name=user]")
    const events: string[] = []
    let clearedOnce = false
    for (const type of ["keydown", "input", "keyup", "change"]) {
      input.addEventListener(type, () => {
        events.push(type)
        if (type === "input" && !clearedOnce) {
          clearedOnce = true
          input.value = ""
        }
      })
    }
    setFieldValue(input, "alice")
    expect(input.value).toBe("alice")
    expect(events).toEqual([
      "keydown",
      "input",
      "keyup",
      "change",
      "input",
      "change",
    ])
  })

  it("fills select, textarea and radio controls and supports prefixes, regex and csv matchers", () => {
    document.body.innerHTML = `
      <form>
        <input name="username">
        <input type="password" name="password">
        <select id="region_select" name="region">
          <option value="us">United States</option>
          <option value="eu">Europe</option>
        </select>
        <textarea name="security_answer" placeholder="Your answer"></textarea>
        <input type="radio" name="plan" value="personal" id="plan-p">
        <input type="radio" name="plan" value="team" id="plan-t">
        <input type="text" id="tenant-01" name="org" placeholder="Company code">
      </form>`
    const username = requireInput("[name=username]")
    const password = requireInput("[name=password]")
    fillCustomFields(
      username,
      [
        { name: "id=region_select", text: "Europe" },
        { name: "placeholder=csv=answer, your answer", text: "Fluffy" },
        { name: "name=plan", text: "team" },
        { name: "id=regex=^tenant-\\d+$", text: "ACME" },
      ],
      [username, password],
    )
    expect(
      document.querySelector<HTMLSelectElement>("#region_select")?.value,
    ).toBe("eu")
    expect(
      document.querySelector<HTMLTextAreaElement>("[name=security_answer]")
        ?.value,
    ).toBe("Fluffy")
    expect(document.querySelector<HTMLInputElement>("#plan-t")?.checked).toBe(
      true,
    )
    expect(document.querySelector<HTMLInputElement>("#tenant-01")?.value).toBe(
      "ACME",
    )
  })

  it("extracts the best element identifier in priority order", () => {
    document.body.innerHTML = `
      <form>
        <input id="acct-id" name="acct-name" placeholder="Account">
        <input name="only-name" placeholder="Placeholder">
        <input aria-label="Tenant code">
        <label>Member number <input type="text" class="labeled"></label>
      </form>`
    expect(elementIdentifierOf(document.getElementById("acct-id"))).toBe(
      "acct-id",
    )
    expect(
      elementIdentifierOf(document.querySelector("[name=only-name]")),
    ).toBe("only-name")
    expect(
      elementIdentifierOf(document.querySelector('[aria-label="Tenant code"]')),
    ).toBe("Tenant code")
    expect(elementIdentifierOf(document.querySelector(".labeled"))).toBe(
      "Member number",
    )
  })
})

// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  codeBoxes,
  fillTargets,
  findFields,
  newPasswordTargets,
} from "./field-finder"
import { fillCodeField, fillCustomFields } from "./fill-dom"
import { credentialsAround } from "./submitted-login"
import { stubLayout } from "./test-support"

/** The fields a scan of the page finds, by the part they play. */
function scan() {
  return findFields(document)
}

/** The fields' names; the order a scan lists them in plays no part. */
function names(fields: readonly HTMLInputElement[]): Set<string> {
  return new Set(fields.map((input) => input.name))
}

function field(name: string, root: ParentNode = document): HTMLInputElement {
  const found = root.querySelector<HTMLInputElement>(`[name="${name}"]`)
  if (!found) throw new Error(`No field named ${name}`)
  return found
}

function type(name: string, value: string, root?: ParentNode): void {
  field(name, root).value = value
}

beforeEach(stubLayout)

afterEach(() => {
  vi.restoreAllMocks()
  document.head.innerHTML = ""
  document.body.innerHTML = ""
})

describe("a sign-in form", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <form>
        <input type="email" name="email" autocomplete="username">
        <input type="password" name="password" autocomplete="current-password">
        <input type="checkbox" name="remember">
        <button>Sign in</button>
      </form>`
  })

  it("offers logins on its username and password", () => {
    expect(names(scan().login)).toEqual(new Set(["email", "password"]))
    expect(scan().newPassword).toEqual([])
    expect(scan().code).toEqual([])
  })

  it("fills a login into both fields from either one", () => {
    for (const anchor of ["email", "password"])
      expect(fillTargets(field(anchor))).toEqual({
        username: field("email"),
        password: field("password"),
      })
  })

  it("reads the login it submits", () => {
    type("email", " user@example.com ")
    type("password", "{{SECRET_xbfqywla}}")
    expect(credentialsAround(field("password"))).toEqual({
      username: "user@example.com",
      password: "{{SECRET_xbfqywla}}",
      newPassword: false,
    })
  })

  it("leaves out fields that are hidden, disabled or read-only", () => {
    document.body.innerHTML = `
      <form>
        <input name="hidden-user" style="display: none">
        <input name="faded-user" style="opacity: 0">
        <input name="disabled-user" disabled>
        <input name="read-only-user" readonly>
        <input type="password" name="password">
      </form>`
    expect(names(scan().login)).toEqual(new Set(["password"]))
  })

  it("takes a field for an email address as the username, but not one for a street address", () => {
    document.body.innerHTML = `
      <form>
        <input name="street" placeholder="Street address">
        <input type="email" name="email" placeholder="Email address">
        <input type="password" name="password">
      </form>
      <form>
        <input name="login" aria-label="Username or email address">
      </form>`
    expect(names(scan().login)).toEqual(new Set(["email", "password", "login"]))
    expect(fillTargets(field("password")).username).toBe(field("email"))
  })

  it("takes the page's mark for a username over the field's type and names, and passes over decoys", () => {
    document.body.innerHTML = `
      <form>
        <input name="fakeusernameremembered">
        <input type="password" name="fakepasswordremembered">
        <input type="search" name="userID" autocomplete="username">
        <input type="password" name="password">
      </form>`
    expect(names(scan().login)).toEqual(new Set(["userID", "password"]))
    expect(scan().newPassword).toEqual([])
    expect(fillTargets(field("password")).username).toBe(field("userID"))
  })

  it("keeps a password marked new-password as the login's when a forgot-password link is near", () => {
    document.body.innerHTML = `
      <div>
        <form>
          <input name="username">
          <input type="password" name="password" autocomplete="new-password">
        </form>
        <a href="/reset">Forgot password?</a>
      </div>`
    expect(names(scan().login)).toEqual(new Set(["username", "password"]))
    expect(scan().newPassword).toEqual([])
  })
})

describe("a sign-up form", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <form>
        <input type="email" name="email">
        <input type="password" name="password" autocomplete="new-password">
        <input type="password" name="confirm" autocomplete="new-password">
      </form>`
  })

  it("offers a new password on both password fields", () => {
    expect(names(scan().newPassword)).toEqual(new Set(["password", "confirm"]))
    expect(scan().login).toEqual([])
  })

  it("fills a generated password into the field and its confirmation", () => {
    expect(
      names(newPasswordTargets(field("password"), scan().newPassword)),
    ).toEqual(new Set(["password", "confirm"]))
  })

  it("takes a second password field that asks to confirm as a new password and its confirmation", () => {
    document.body.innerHTML = `
      <form>
        <input type="password" name="password">
        <input type="password" name="confirmPassword">
      </form>`
    expect(names(scan().newPassword)).toEqual(
      new Set(["password", "confirmPassword"]),
    )
  })

  it("takes two password fields after a username as a new password and its confirmation", () => {
    document.body.innerHTML = `
      <form>
        <input name="username">
        <input type="password" name="first">
        <input type="password" name="second">
      </form>`
    expect(names(scan().newPassword)).toEqual(new Set(["first", "second"]))
    expect(scan().login).toEqual([])
  })

  it("takes a form's only password field as new when the form submits with a sign-up button", () => {
    document.body.innerHTML = `
      <form>
        <input type="email" name="email">
        <input type="password" name="password">
        <button>
          Create account
        </button>
      </form>`
    expect(names(scan().newPassword)).toEqual(new Set(["password"]))
    expect(scan().login).toEqual([])
  })

  it("keeps a form's only password field the login's beside a sign-in button or a forgot-password link", () => {
    document.body.innerHTML = `
      <form>
        <input type="password" name="beside-sign-in">
        <button type="submit">Sign up</button>
        <input type="submit" value="Log in">
      </form>
      <form>
        <input type="password" name="beside-forgot">
        <a href="/forgot">Forgot password?</a>
        <button>Join</button>
      </form>`
    expect(names(scan().login)).toEqual(
      new Set(["beside-sign-in", "beside-forgot"]),
    )
    expect(scan().newPassword).toEqual([])
  })

  it("reads the new password it submits", () => {
    type("email", "user@example.com")
    type("password", "{{SECRET_0rjx6wrn}}")
    type("confirm", "{{SECRET_0rjx6wrn}}")
    expect(credentialsAround(field("confirm"))).toEqual({
      username: "user@example.com",
      password: "{{SECRET_0rjx6wrn}}",
      newPassword: true,
    })
  })
})

describe("a change-password form", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <form>
        <input type="hidden" name="username" autocomplete="username" value="user@example.com">
        <input type="password" name="first">
        <input type="password" name="second">
        <input type="password" name="third">
      </form>`
  })

  it("takes the first of three password fields as the current one", () => {
    expect(names(scan().login)).toEqual(new Set(["first"]))
    expect(names(scan().newPassword)).toEqual(new Set(["second", "third"]))
  })

  it("takes the first of three password fields as the current one after a username too", () => {
    document.body.innerHTML = `
      <form>
        <input name="username">
        <input type="password" name="first">
        <input type="password" name="second">
        <input type="password" name="third">
      </form>`
    expect(names(scan().login)).toEqual(new Set(["username", "first"]))
    expect(names(scan().newPassword)).toEqual(new Set(["second", "third"]))
  })

  it("keeps the first of two unclear password fields as the current one", () => {
    document.body.innerHTML = `
      <form>
        <input type="password" name="first">
        <input type="password" name="second">
      </form>`
    expect(names(scan().login)).toEqual(new Set(["first"]))
    expect(names(scan().newPassword)).toEqual(new Set(["second"]))
  })

  it("reads the new password and the username it keeps in a hidden field", () => {
    type("first", "{{SECRET_10fh9udf}}")
    type("second", "{{SECRET_0rjx6wrn}}")
    type("third", "{{SECRET_0rjx6wrn}}")
    expect(credentialsAround(field("third"))).toEqual({
      username: "user@example.com",
      password: "{{SECRET_0rjx6wrn}}",
      newPassword: true,
    })
  })
})

describe("the first step of a two-step sign-in", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <form>
        <input name="identifier" placeholder="Email or phone">
        <button>Next</button>
      </form>
      <form>
        <input name="query" placeholder="Search">
      </form>`
  })

  it("offers logins on a lone field that looks like a username", () => {
    expect(names(scan().login)).toEqual(new Set(["identifier"]))
  })

  it("fills only the username", () => {
    expect(fillTargets(field("identifier"))).toEqual({
      username: field("identifier"),
      password: null,
    })
  })

  it("reads the username it submits", () => {
    type("identifier", "user@example.com")
    expect(credentialsAround(field("identifier"))).toEqual({
      username: "user@example.com",
      password: "",
      newPassword: false,
    })
  })
})

describe("a one-time code", () => {
  const BOXES = Array.from(
    { length: 6 },
    (_, index) =>
      `<input name="digit-${index}" maxlength="1" autocomplete="one-time-code">`,
  ).join("")

  it("split over one-character boxes counts once, as its first box", () => {
    document.body.innerHTML = `<form>${BOXES}</form>`
    expect(names(scan().code)).toEqual(new Set(["digit-0"]))
    expect(codeBoxes(field("digit-3"))).toHaveLength(6)
  })

  it("goes into its boxes one character each", () => {
    document.body.innerHTML = `<form>${BOXES}</form>`
    fillCodeField(field("digit-2"), "123456")
    expect(
      [...document.querySelectorAll("input")].map((box) => box.value),
    ).toEqual(["1", "2", "3", "4", "5", "6"])
  })

  it("goes whole into a single field", () => {
    document.body.innerHTML = `
      <form>
        <input name="otp" maxlength="6" inputmode="numeric">
        <input name="sms-code" placeholder="SMS verification code">
      </form>`
    expect(names(scan().code)).toEqual(new Set(["otp"]))
    fillCodeField(field("otp"), "123456")
    expect(field("otp").value).toBe("123456")
  })
})

describe("a form in a shadow root", () => {
  it("is found and filled like one in the page", () => {
    document.body.innerHTML = "<sign-in-box></sign-in-box>"
    const shadow = document
      .querySelector("sign-in-box")
      ?.attachShadow({ mode: "open" })
    if (!shadow) throw new Error("No shadow root")
    shadow.innerHTML = `
      <form>
        <input name="username">
        <input type="password" name="password">
      </form>`
    expect(names(scan().login)).toEqual(new Set(["username", "password"]))
    expect(fillTargets(field("username", shadow)).password).toBe(
      field("password", shadow),
    )
  })

  it("belongs to the page's form around its host", () => {
    document.body.innerHTML = `
      <form>
        <text-field></text-field>
        <input type="password" name="password">
      </form>`
    const shadow = document
      .querySelector("text-field")
      ?.attachShadow({ mode: "open" })
    if (!shadow) throw new Error("No shadow root")
    shadow.innerHTML = `<input name="username">`
    expect(fillTargets(field("password"))).toEqual({
      username: field("username", shadow),
      password: field("password"),
    })
  })
})

describe("a checkout form", () => {
  it("is not taken for a login", () => {
    document.body.innerHTML = `
      <form>
        <input type="email" name="email" autocomplete="shipping email">
        <input type="tel" name="phone" autocomplete="billing tel">
        <input name="name" autocomplete="cc-name">
        <input name="card" autocomplete="cc-number">
      </form>`
    expect(scan()).toEqual({ login: [], newPassword: [], code: [] })
  })

  it("does not offer logins on a phone or email field among fields for other data", () => {
    document.body.innerHTML = `
      <form>
        <input type="tel" name="phone" autocomplete="tel">
        <input name="street" autocomplete="street-address">
      </form>
      <form>
        <input name="first-name">
        <input name="last-name">
        <input name="company">
        <input type="email" name="email">
        <input type="tel" name="mobile">
      </form>`
    expect(scan().login).toEqual([])
  })

  it("does not take a card's security code or a name for a login, even in password fields", () => {
    document.body.innerHTML = `
      <form>
        <input name="lastName" autocomplete="cc-family-name">
        <input name="month" autocomplete="cc-exp-month">
        <input type="password" name="cvv" autocomplete="cc-csc">
      </form>`
    expect(scan()).toEqual({ login: [], newPassword: [], code: [] })
  })

  it("offers logins on a lone phone field only when its form has a button to sign in", () => {
    document.body.innerHTML = `
      <form>
        <input type="tel" name="delivery-phone" placeholder="Phone number">
        <button>Continue to payment</button>
      </form>
      <form>
        <input type="tel" name="mobile" placeholder="手机号">
        <button type="button">获取验证码</button>
        <button>登录</button>
      </form>`
    expect(names(scan().login)).toEqual(new Set(["mobile"]))
  })
})

describe("a form with other secrets in password fields", () => {
  it("takes neither security answers nor one-character boxes for passwords", () => {
    document.body.innerHTML = `
      <form>
        <input name="email">
        <input type="password" name="password">
        <input type="password" name="securityAnswer">
        <input type="password" name="answerAgain">
      </form>
      <form>
        <input type="password" name="pin-1" maxlength="1">
        <input type="password" name="pin-2" maxlength="1">
      </form>`
    expect(names(scan().login)).toEqual(new Set(["email", "password"]))
    expect(scan().newPassword).toEqual([])
  })

  it("takes a password called PIN for the login's", () => {
    document.body.innerHTML = `
      <form>
        <input name="account">
        <input type="password" name="pin">
      </form>`
    expect(names(scan().login)).toEqual(new Set(["account", "pin"]))
  })

  it("passes over a last name between the member number and the password", () => {
    document.body.innerHTML = `
      <form>
        <input name="memberId" aria-label="Membership number">
        <input name="lastName">
        <input type="password" name="password">
      </form>`
    expect(fillTargets(field("password")).username).toBe(field("memberId"))
  })
})

describe("a login's custom fields", () => {
  it("go into the fields of the same name in the form, ignoring case", () => {
    document.body.innerHTML = `
      <form>
        <input name="username">
        <input type="password" name="password">
        <label>Team <input name="team-field"></label>
        <input type="checkbox" name="sso" aria-label="SSO enforced">
      </form>`
    fillCustomFields(
      field("password"),
      [
        { name: "team", text: "Platform" },
        { name: "SSO Enforced", checked: true },
        { name: "password", text: "not for the password field" },
      ],
      [field("username"), field("password")],
    )
    expect(field("team-field").value).toBe("Platform")
    expect(field("sso").checked).toBe(true)
    expect(field("password").value).toBe("")
  })
})

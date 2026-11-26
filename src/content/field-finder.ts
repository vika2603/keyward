/** Finding the login, new-password and one-time code fields of a page, and the fields beside them. */

import type { FieldRules } from "@/lib/password-rules"
import { composedParent, deepInputs, formOf, scopeOf } from "./deep-dom"
import {
  CONFIRM_PASSWORD_HINT,
  CURRENT_PASSWORD_HINT,
  hasAutocomplete,
  hintWords,
  isCodeField,
  isDecoyField,
  isPasswordField,
  isTextField,
  looksLikeUsername,
  marksNewPassword,
  marksOtherData,
  NAME_PART_HINT,
  NEW_PASSWORD_HINT,
  suggestsOnlyPhone,
} from "./field-hints"

/** Elements smaller than this, in CSS pixels, either way are taken as hidden. */
const MIN_VISIBLE_SIZE = 8
/** Elements at or below this opacity are taken as hidden. */
const MAX_HIDDEN_OPACITY = 0.05
/** A link sign-in forms have and sign-up forms do not. */
const FORGOT_PASSWORD_HINT = /\bforgot\b|忘记密码|忘記密碼|找回密码|找回密碼/i
/** Text beyond this length belongs to more of the page than a form and its own links. */
const SURROUNDING_TEXT_MAX = 2000
/** Submit button text of sign-up and sign-in forms, matched with runs of white space collapsed. */
const SIGN_UP_SUBMIT =
  /\b(sign ?up|register|create( an| my| your)? account|join)\b|注册|註冊|创建账号|创建帐号|建立帳號/i
const SIGN_IN_SUBMIT = /\b(log ?in|sign ?in)\b|登录|登入|登陆|登錄/i
/** Input types that take typed text, counted to tell a login step from a longer form. */
const TYPED_TYPES = new Set(["text", "email", "tel", "number", "search", "url"])
/** The most typed fields a login step has beside its username field. */
const MAX_FIELDS_BESIDE_USERNAME = 3

export function isVisible(element: HTMLElement): boolean {
  if (!element.isConnected) return false
  const rect = element.getBoundingClientRect()
  if (rect.width < MIN_VISIBLE_SIZE || rect.height < MIN_VISIBLE_SIZE)
    return false
  const style = getComputedStyle(element)
  return (
    style.visibility !== "hidden" &&
    style.display !== "none" &&
    Number(style.opacity) > MAX_HIDDEN_OPACITY
  )
}

/** Whether the user could type into the field now. Hidden inputs are left out before any layout read. */
export function isFillable(input: HTMLInputElement): boolean {
  return (
    input.type !== "hidden" &&
    !input.disabled &&
    !input.readOnly &&
    !isDecoyField(input) &&
    isVisible(input)
  )
}

/**
 * Whether a forgot-password link sits around a password field, with no other password field closer:
 * the field is a sign-in form's, though the page may mark it `new-password` to keep the browser's
 * own autofill away. The link is often outside the `<form>`, so the search climbs past it.
 */
function nearForgotPassword(password: HTMLInputElement): boolean {
  for (let node = composedParent(password); node; node = composedParent(node)) {
    const others = node.querySelectorAll('input[type="password"]')
    if ([...others].some((field) => field !== password)) return false
    const text = node.textContent ?? ""
    if (text.length > SURROUNDING_TEXT_MAX) return false
    if (FORGOT_PASSWORD_HINT.test(text)) return true
  }
  return false
}

const SUBMIT_CONTROLS =
  'button[type="submit"], button:not([type]), input[type="submit"]'
const BUTTONS =
  'button, input[type="submit"], input[type="button"], [role="button"]'

/**
 * How many levels with more than one child a search climbs from a field outside a form to its
 * buttons; wrappers around a single element do not count.
 */
const MAX_BRANCHING_LEVELS = 5

/** The labels of the controls in `container` that match `selector`, with runs of white space collapsed. */
function controlLabels(container: Element, selector: string): string[] {
  return [...container.querySelectorAll<HTMLElement>(selector)].map((control) =>
    (control instanceof HTMLInputElement
      ? control.value
      : (control.textContent ?? "")
    )
      .replace(/\s+/g, " ")
      .trim(),
  )
}

/**
 * Whether a field's form submits with a sign-up button and has none for signing in. Only the
 * form's own submit controls count; a page's other buttons may belong to any of its forms.
 */
function submitsSignUp(field: HTMLInputElement): boolean {
  const form = formOf(field)
  if (!form) return false
  const labels = controlLabels(form, SUBMIT_CONTROLS)
  return (
    labels.some((label) => SIGN_UP_SUBMIT.test(label)) &&
    !labels.some((label) => SIGN_IN_SUBMIT.test(label))
  )
}

/**
 * The element whose buttons go with a field: its form, or for a field outside a form the nearest
 * ancestor with a button, as pages built without forms group a field with its buttons. Null when
 * no such ancestor is close.
 */
function buttonGroupOf(field: HTMLInputElement): Element | null {
  const form = formOf(field)
  if (form) return form
  let levels = 0
  for (
    let node = composedParent(field);
    node && node !== field.ownerDocument.body;
    node = composedParent(node)
  ) {
    if (node.querySelector(BUTTONS)) return node
    if (node.childElementCount > 1 && ++levels >= MAX_BRANCHING_LEVELS) break
  }
  return null
}

/**
 * Whether a lone field that only looks like a phone number belongs to a sign-in: checkout,
 * contact and sign-up forms ask for a phone too, so the buttons that go with it must include one
 * to sign in. A field with no buttons near counts, as nothing tells it apart.
 */
function phoneSignsIn(field: HTMLInputElement): boolean {
  const group = buttonGroupOf(field)
  if (!group) return true
  return controlLabels(group, BUTTONS).some((label) =>
    SIGN_IN_SUBMIT.test(label),
  )
}

export interface FoundFields {
  /**
   * Fields that get the icon: visible password fields, the username field before each, and fields
   * that look like a username on their own, as on the first page of a two-step login.
   */
  login: HTMLInputElement[]
  /** Password fields that take a new password; they get the icon and a generated password offered. */
  newPassword: HTMLInputElement[]
  /**
   * Fields that take a one-time code. A field found as a login field stays one, unless the page
   * marks it as a one-time code field, which login fields leave out. A code split over
   * one-character boxes counts once, as its first box, so moving from box to box while typing does
   * not reopen the menu.
   */
  code: HTMLInputElement[]
}

/** The fillable inputs of each scope, a form or the document, found once per lookup. */
export class FieldIndex {
  private readonly cache = new Map<ParentNode, HTMLInputElement[]>()

  inputs(scope: ParentNode): HTMLInputElement[] {
    let inputs = this.cache.get(scope)
    if (!inputs) {
      inputs = deepInputs(scope).filter(isFillable)
      this.cache.set(scope, inputs)
    }
    return inputs
  }

  /**
   * The text field closest before a password field in the same form, which holds the username.
   * Fields for a person's name are passed over, as forms that sign in with a member number may
   * ask for a last name between it and the password.
   */
  usernameFor(password: HTMLInputElement): HTMLInputElement | null {
    const inputs = this.inputs(scopeOf(password))
    for (let index = inputs.indexOf(password) - 1; index >= 0; index--) {
      const input = inputs[index]
      if (input && isTextField(input) && !NAME_PART_HINT.test(hintWords(input)))
        return input
    }
    return null
  }

  /** The first password field after a username field in the same form. */
  passwordFor(username: HTMLInputElement): HTMLInputElement | null {
    const inputs = this.inputs(scopeOf(username))
    return (
      inputs.slice(inputs.indexOf(username) + 1).find(isPasswordField) ?? null
    )
  }

  /**
   * Whether a password field takes a new password: the page or the field's name says so, or its
   * form has more password fields. A page's `new-password` mark is overruled by a forgot-password
   * link around the field. Three fields are the current password, a new one and its
   * confirmation. Two are either a new password and its confirmation, as on sign-up, or the current
   * password and a new one; the first field counts as new only when the second asks to confirm it
   * or a username comes before it. Taking a current password for a new one would let a suggested
   * password overwrite it, so the unclear case keeps the first field as the current one. A form's
   * only password field is new when the form submits with a sign-up button and no forgot-password
   * link sits around it.
   */
  isNewPassword(input: HTMLInputElement): boolean {
    if (hasAutocomplete(input, "current-password")) return false
    if (marksNewPassword(input))
      return (
        NEW_PASSWORD_HINT.test(hintWords(input)) || !nearForgotPassword(input)
      )
    const text = hintWords(input)
    if (CURRENT_PASSWORD_HINT.test(text)) return false
    if (NEW_PASSWORD_HINT.test(text)) return true
    const passwords = this.inputs(scopeOf(input)).filter(isPasswordField)
    const index = passwords.indexOf(input)
    if (index < 0) return false
    if (passwords.length === 1)
      return submitsSignUp(input) && !nearForgotPassword(input)
    if (index > 0) return true
    if (passwords.length > 2) return false
    const second = passwords[1] as HTMLInputElement
    if (marksNewPassword(second) || NEW_PASSWORD_HINT.test(hintWords(second)))
      return false
    return (
      CONFIRM_PASSWORD_HINT.test(hintWords(second)) ||
      this.usernameFor(input) !== null
    )
  }

  loginFields(root: Document): HTMLInputElement[] {
    const inputs = this.inputs(root)
    const fields = new Set<HTMLInputElement>()
    for (const password of inputs.filter(isPasswordField)) {
      if (this.isNewPassword(password)) continue
      fields.add(password)
      const username = this.usernameFor(password)
      if (username) fields.add(username)
    }
    for (const input of inputs) {
      if (
        !fields.has(input) &&
        looksLikeUsername(input) &&
        !this.inputs(scopeOf(input)).some(
          (field) => field.type === "password",
        ) &&
        !this.inLongerForm(input) &&
        (!suggestsOnlyPhone(input) || phoneSignsIn(input))
      ) {
        fields.add(input)
      }
    }
    return [...fields]
  }

  /**
   * Whether a field's form asks for more than a login step: other fields there are marked for
   * other data, such as an address or a card, or there are more typed fields than a login step
   * has. Outside a form the document holds every field of the page, so they are not counted.
   */
  private inLongerForm(input: HTMLInputElement): boolean {
    const form = formOf(input)
    if (!form) return false
    const others = this.inputs(form).filter(
      (field) => field !== input && TYPED_TYPES.has(field.type),
    )
    return (
      others.length > MAX_FIELDS_BESIDE_USERNAME || others.some(marksOtherData)
    )
  }

  newPasswordFields(root: Document): HTMLInputElement[] {
    return this.inputs(root).filter(
      (input) => isPasswordField(input) && this.isNewPassword(input),
    )
  }

  codeFields(
    root: Document,
    knownLoginFields: readonly HTMLInputElement[],
  ): HTMLInputElement[] {
    const found = new Set<HTMLInputElement>()
    for (const input of this.inputs(root)) {
      if (isCodeField(input) && !knownLoginFields.includes(input))
        found.add(this.codeBoxes(input)[0] ?? input)
    }
    return [...found]
  }

  /**
   * The one-character boxes a code is split over, in order, when `field` is one of them; otherwise
   * just `field`.
   */
  codeBoxes(field: HTMLInputElement): HTMLInputElement[] {
    if (field.maxLength !== 1) return [field]
    const inputs = this.inputs(scopeOf(field))
    const index = inputs.indexOf(field)
    if (index < 0) return [field]
    let start = index
    while (start > 0 && inputs[start - 1]?.maxLength === 1) start--
    let end = index
    while (end + 1 < inputs.length && inputs[end + 1]?.maxLength === 1) end++
    return inputs.slice(start, end + 1)
  }
}

/** The page's login, new-password and code fields, found in one pass over the page. */
export function findFields(root: Document): FoundFields {
  const index = new FieldIndex()
  const login = index.loginFields(root)
  const newPassword = index.newPasswordFields(root)
  return {
    login,
    newPassword,
    code: index.codeFields(root, [...login, ...newPassword]),
  }
}

export function codeBoxes(field: HTMLInputElement): HTMLInputElement[] {
  return new FieldIndex().codeBoxes(field)
}

/** The username and password fields a login for `anchor` goes into. */
export function fillTargets(anchor: HTMLInputElement): {
  username: HTMLInputElement | null
  password: HTMLInputElement | null
} {
  const index = new FieldIndex()
  if (isPasswordField(anchor))
    return { username: index.usernameFor(anchor), password: anchor }
  return { username: anchor, password: index.passwordFor(anchor) }
}

/**
 * What new-password fields set for a password: the first `passwordrules` attribute among them
 * and the strictest length limits, which apply as the same password goes into each.
 */
export function fieldRulesOf(fields: readonly HTMLInputElement[]): FieldRules {
  const minimums = fields
    .map((field) => field.minLength)
    .filter((length) => length > 0)
  const maximums = fields
    .map((field) => field.maxLength)
    .filter((length) => length > 0)
  return {
    rules:
      fields
        .map((field) => field.getAttribute("passwordrules"))
        .find((rules) => rules?.trim()) ?? null,
    minLength: minimums.length ? Math.max(...minimums) : null,
    maxLength: maximums.length ? Math.min(...maximums) : null,
  }
}

/** The fields a generated password goes into: `anchor` and the others of its form, such as a confirmation. */
export function newPasswordTargets(
  anchor: HTMLInputElement,
  fields: readonly HTMLInputElement[],
): HTMLInputElement[] {
  const scope = scopeOf(anchor)
  return fields.filter((field) => field === anchor || scopeOf(field) === scope)
}

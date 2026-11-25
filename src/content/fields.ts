/**
 * Finding login fields in a page and filling them. Fields inside open shadow roots count too, as
 * web components put them there; a login form is the nearest `<form>` across shadow boundaries.
 */

import type { FillField } from "@/lib/providers/types"

const TEXT_TYPES = new Set(["text", "email", "tel", ""])
const USERNAME_HINT =
  /user|email|e-mail|login|account|identifier|phone|mobile|账号|帳號|用户|手机|邮箱|邮件|郵件/i
const EXCLUDED_HINT =
  /search|captcha|otp|one-time|verification|code|coupon|promo|card|cvv|zip|postal|address|验证码|驗證碼/i
const CODE_TYPES = new Set(["text", "tel", "number", "password", ""])
const CODE_HINT =
  /one-?time|otp|2fa|mfa|two-?factor|totp|authenticator|verif\w*[\s_-]*code|auth\w*[\s_-]*code|passcode|验证码|驗證碼|动态码|動態碼|校验码/i
/**
 * Codes that come from somewhere other than an authenticator, such as a picture, a text message,
 * an email or a payment card.
 */
const NOT_AUTHENTICATOR_HINT =
  /captcha|image|图形|图片|圖形|短信|簡訊|sms|text message|mail|邮箱|郵箱|邮件|郵件|card|cvv|cvc|csc|credit|coupon|promo|gift|invite|referral|邀请|邀請/i
/** Longer fields take something other than a one-time code. */
const CODE_MAX_LENGTH = 12
/**
 * Autocomplete values for data other than a login: names, addresses, payment cards, birthdays and
 * parts of a phone number. A whole phone number (`tel`) is left out, as many sites sign in with one.
 */
const OTHER_DATA_AUTOCOMPLETE =
  /^(name|honorific-\w+|given-name|additional-name|family-name|nickname|organization(-title)?|street-address|address-\w+|country(-name)?|postal-code|cc-\w+|transaction-\w+|language|bday(-\w+)?|sex|url|photo|impp|tel-(country-code|area-code|local(-\w+)?|extension))$/
/** Autocomplete sections for checkout forms, whose email and phone are not a login. */
const CHECKOUT_AUTOCOMPLETE = new Set(["billing", "shipping"])
/** Matched against `hintWords`, so English words stand apart. */
const NEW_PASSWORD_HINT =
  /\b(new|register|registration|sign ?up|create)\b|新密码|新密碼|设置密码|設定密碼/i
const CONFIRM_PASSWORD_HINT =
  /\b(confirm|confirmation|repeat|retype|again|verify)\b|确认|確認|重复|重複|再次/i
const CURRENT_PASSWORD_HINT =
  /\b(current|old|existing|previous)\b|当前|目前|旧密码|舊密碼|原密码|原密碼/i
/** A link sign-in forms have and sign-up forms do not. */
const FORGOT_PASSWORD_HINT = /\bforgot\b|忘记密码|忘記密碼|找回密码|找回密碼/i
/** Text beyond this length belongs to more of the page than a form and its own links. */
const SURROUNDING_TEXT_MAX = 2000

export function isVisible(element: HTMLElement): boolean {
  if (!element.isConnected) return false
  const rect = element.getBoundingClientRect()
  if (rect.width < 8 || rect.height < 8) return false
  const style = getComputedStyle(element)
  return (
    style.visibility !== "hidden" &&
    style.display !== "none" &&
    Number(style.opacity) > 0.05
  )
}

function usable(input: HTMLInputElement): boolean {
  return !input.disabled && !input.readOnly && isVisible(input)
}

export function isPasswordField(
  element: EventTarget | null,
): element is HTMLInputElement {
  return element instanceof HTMLInputElement && element.type === "password"
}

/** The field's autocomplete values in lower case, such as `billing` and `email`; the HTML standard ignores case. */
function autocompleteValues(input: HTMLInputElement): string[] {
  const attribute = input.getAttribute("autocomplete") ?? ""
  return attribute.toLowerCase().split(/\s+/).filter(Boolean)
}

function hasAutocomplete(input: HTMLInputElement, value: string): boolean {
  return autocompleteValues(input).includes(value)
}

/** Whether the page marks the field for something other than a login, such as an address or a card. */
function marksOtherData(input: HTMLInputElement): boolean {
  return autocompleteValues(input).some(
    (value) =>
      CHECKOUT_AUTOCOMPLETE.has(value) || OTHER_DATA_AUTOCOMPLETE.test(value),
  )
}

function isNewPassword(input: HTMLInputElement): boolean {
  return hasAutocomplete(input, "new-password")
}

function hints(input: HTMLInputElement): string {
  return [
    input.name,
    input.id,
    input.placeholder,
    input.getAttribute("aria-label") ?? "",
  ].join(" ")
}

/** The field's hints with camelCase, underscores and dashes split into words. */
function hintWords(input: HTMLInputElement): string {
  return hints(input)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-.[\]]+/g, " ")
}

function hasCodeAutocomplete(input: HTMLInputElement): boolean {
  return hasAutocomplete(input, "one-time-code")
}

function isTextField(input: HTMLInputElement): boolean {
  return (
    TEXT_TYPES.has(input.type) &&
    !hasCodeAutocomplete(input) &&
    !marksOtherData(input) &&
    !EXCLUDED_HINT.test(hints(input))
  )
}

/**
 * A text field that looks like it takes a username or email, judged without a password field.
 * `webauthn` marks the field a page offers passkeys on, which is where a username goes.
 */
function looksLikeUsername(input: HTMLInputElement): boolean {
  if (!isTextField(input)) return false
  const values = autocompleteValues(input)
  const marksUsername = ["username", "email", "webauthn"].some((value) =>
    values.includes(value),
  )
  if (marksUsername) return true
  if (values.includes("new-password")) return false
  return input.type === "email" || USERNAME_HINT.test(hints(input))
}

/** A field for a one-time code from an authenticator. */
function isCodeField(input: HTMLInputElement): boolean {
  if (!CODE_TYPES.has(input.type)) return false
  if (input.maxLength > CODE_MAX_LENGTH) return false
  if (hasCodeAutocomplete(input)) return true
  if (marksOtherData(input)) return false
  const text = hints(input)
  return CODE_HINT.test(text) && !NOT_AUTHENTICATOR_HINT.test(text)
}

/** The element an event started at, inside any shadow root, rather than the retargeted host. */
export function eventOrigin(event: Event): EventTarget | null {
  return event.composedPath()[0] ?? event.target
}

/** The focused element, looking into open shadow roots. */
export function deepActiveElement(): Element | null {
  let active = document.activeElement
  while (active?.shadowRoot?.activeElement)
    active = active.shadowRoot.activeElement
  return active
}

/** The nearest ancestor matching a selector, continuing past shadow roots to their hosts. */
function composedClosest(element: Element, selector: string): Element | null {
  let current: Element | null = element
  while (current) {
    const found = current.closest(selector)
    if (found) return found
    const root = current.getRootNode()
    current = root instanceof ShadowRoot ? root.host : null
  }
  return null
}

function composedParent(element: Element): Element | null {
  if (element.parentElement) return element.parentElement
  const root = element.getRootNode()
  return root instanceof ShadowRoot ? root.host : null
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

function formOf(element: Element): HTMLFormElement | null {
  if (element instanceof HTMLInputElement && element.form) return element.form
  const form = composedClosest(element, "form")
  return form instanceof HTMLFormElement ? form : null
}

function scopeOf(element: Element): ParentNode {
  return formOf(element) ?? element.ownerDocument
}

/** All inputs in a scope in tree order, including those in open shadow roots inside it. */
function deepInputs(scope: ParentNode): HTMLInputElement[] {
  const found: HTMLInputElement[] = []
  const visit = (root: Node) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node instanceof HTMLInputElement) found.push(node)
      const shadow = (node as Element).shadowRoot
      if (shadow) visit(shadow)
    }
  }
  visit(scope as unknown as Node)
  return found
}

/** Usable inputs per scope, computed once per lookup. */
class Scopes {
  private readonly cache = new Map<ParentNode, HTMLInputElement[]>()

  inputs(scope: ParentNode): HTMLInputElement[] {
    let inputs = this.cache.get(scope)
    if (!inputs) {
      inputs = deepInputs(scope).filter(usable)
      this.cache.set(scope, inputs)
    }
    return inputs
  }

  /** The text field right before a password field in the same form, which holds the username. */
  usernameFor(password: HTMLInputElement): HTMLInputElement | null {
    const inputs = this.inputs(scopeOf(password))
    for (let i = inputs.indexOf(password) - 1; i >= 0; i--) {
      const input = inputs[i]
      if (input && isTextField(input)) return input
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
   * password overwrite it, so the unclear case keeps the first field as the current one.
   */
  isNewPassword(input: HTMLInputElement): boolean {
    if (hasAutocomplete(input, "current-password")) return false
    if (isNewPassword(input))
      return (
        NEW_PASSWORD_HINT.test(hintWords(input)) || !nearForgotPassword(input)
      )
    const text = hintWords(input)
    if (CURRENT_PASSWORD_HINT.test(text)) return false
    if (NEW_PASSWORD_HINT.test(text)) return true
    const passwords = this.inputs(scopeOf(input)).filter(isPasswordField)
    const index = passwords.indexOf(input)
    if (index < 0 || passwords.length < 2) return false
    if (index > 0) return true
    if (passwords.length > 2) return false
    const second = passwords[1] as HTMLInputElement
    if (isNewPassword(second) || NEW_PASSWORD_HINT.test(hintWords(second)))
      return false
    return (
      CONFIRM_PASSWORD_HINT.test(hintWords(second)) ||
      this.usernameFor(input) !== null
    )
  }
}

/**
 * Fields that get the icon: visible password fields, the username field before each, and fields
 * that look like a username on their own, as on the first page of a two-step login.
 */
export function loginFields(root: Document): HTMLInputElement[] {
  const scopes = new Scopes()
  const inputs = scopes.inputs(root)
  const fields = new Set<HTMLInputElement>()
  for (const password of inputs.filter(isPasswordField)) {
    if (scopes.isNewPassword(password) || hasCodeAutocomplete(password))
      continue
    fields.add(password)
    const username = scopes.usernameFor(password)
    if (username) fields.add(username)
  }
  for (const input of inputs) {
    if (
      !fields.has(input) &&
      looksLikeUsername(input) &&
      !scopes.inputs(scopeOf(input)).some(isPasswordField)
    ) {
      fields.add(input)
    }
  }
  return [...fields]
}

/** Password fields that take a new password; they get the icon and a generated password offered. */
export function newPasswordFields(root: Document): HTMLInputElement[] {
  const scopes = new Scopes()
  return scopes
    .inputs(root)
    .filter(
      (input) =>
        isPasswordField(input) &&
        !hasCodeAutocomplete(input) &&
        scopes.isNewPassword(input),
    )
}

/** The fields a generated password goes into: `anchor` and the others of its form, such as a confirmation. */
export function newPasswordTargets(
  anchor: HTMLInputElement,
  fields: readonly HTMLInputElement[],
): HTMLInputElement[] {
  const scope = scopeOf(anchor)
  return fields.filter((field) => field === anchor || scopeOf(field) === scope)
}

/**
 * The one-character boxes a code is split over, in order, when `field` is one of them; otherwise
 * just `field`.
 */
export function codeBoxes(field: HTMLInputElement): HTMLInputElement[] {
  if (field.maxLength !== 1) return [field]
  const inputs = new Scopes().inputs(scopeOf(field))
  const index = inputs.indexOf(field)
  if (index < 0) return [field]
  let start = index
  while (start > 0 && inputs[start - 1]?.maxLength === 1) start--
  let end = index
  while (end + 1 < inputs.length && inputs[end + 1]?.maxLength === 1) end++
  return inputs.slice(start, end + 1)
}

/**
 * Fields that take a one-time code. A field found as a login field stays one, unless the page marks
 * it as a one-time code field, which login fields leave out. A code split over one-character boxes
 * counts once, as its first box, so moving from box to box while typing does not reopen the menu.
 */
export function codeFields(
  root: Document,
  loginFields: readonly HTMLInputElement[],
): HTMLInputElement[] {
  const found = new Set<HTMLInputElement>()
  for (const input of new Scopes().inputs(root)) {
    if (isCodeField(input) && !loginFields.includes(input))
      found.add(codeBoxes(input)[0] ?? input)
  }
  return [...found]
}

/**
 * Fills a one-time code. A code split over one-character boxes goes one character per box, from
 * the first box of the run that holds `anchor`.
 */
export function fillCodeField(anchor: HTMLInputElement, code: string): void {
  const boxes = codeBoxes(anchor)
  if (boxes.length > 1 && boxes.length >= code.length) {
    for (const [index, box] of boxes.slice(0, code.length).entries())
      setFieldValue(box, code[index] ?? "")
    return
  }
  setFieldValue(anchor, code)
}

/** The username and password fields a login for `anchor` goes into. */
export function fillTargets(anchor: HTMLInputElement): {
  username: HTMLInputElement | null
  password: HTMLInputElement | null
} {
  const scopes = new Scopes()
  if (isPasswordField(anchor))
    return { username: scopes.usernameFor(anchor), password: anchor }
  return { username: anchor, password: scopes.passwordFor(anchor) }
}

/** Input types that take neither typed text nor a check mark. */
const NOT_FILLABLE_TYPES = new Set([
  "button",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
])

/** Names a page gives a field: its id, name, aria-label, placeholder and label text, in lower case. */
function pageNamesOf(input: HTMLInputElement): string[] {
  const labels = [...(input.labels ?? [])].map(
    (label) => label.textContent ?? "",
  )
  const names = [
    input.id,
    input.name,
    input.getAttribute("aria-label") ?? "",
    input.placeholder,
    ...labels,
  ]
  return names.map((name) => name.trim().toLowerCase()).filter(Boolean)
}

/**
 * Fills a login's custom fields in the form of `anchor`. Each goes into the visible field whose id,
 * name, aria-label, placeholder or label equals the custom field's name, ignoring case, which is how
 * Bitwarden's apps match them. `skip` holds the fields the username and password go into.
 */
export function fillCustomFields(
  anchor: HTMLInputElement,
  fields: readonly FillField[],
  skip: readonly HTMLInputElement[],
): void {
  if (!fields.length) return
  const candidates = deepInputs(scopeOf(anchor)).filter(
    (input) =>
      usable(input) &&
      !skip.includes(input) &&
      !NOT_FILLABLE_TYPES.has(input.type),
  )
  for (const field of fields) {
    const name = field.name.trim().toLowerCase()
    const target = candidates.find((input) => pageNamesOf(input).includes(name))
    if (!target) continue
    candidates.splice(candidates.indexOf(target), 1)
    const isCheckbox = target.type === "checkbox"
    if ("checked" in field) {
      // A click changes the box the way the user would, so page frameworks see it.
      if (isCheckbox && target.checked !== field.checked) target.click()
    } else if (!isCheckbox) {
      setFieldValue(target, field.text)
    }
  }
}

/** Sets a value the way typing would, so that page frameworks see the change. */
export function setFieldValue(input: HTMLInputElement, value: string): void {
  input.focus()
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set
  if (setter) setter.call(input, value)
  else input.value = value
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }))
  input.dispatchEvent(new Event("change", { bubbles: true, composed: true }))
}

/** Submits the form of a filled field, or clicks the nearby submit button when there is no form. */
export function submitFor(input: HTMLInputElement): void {
  const form = formOf(input)
  if (form) {
    const button = form.querySelector<HTMLElement>(
      'button[type="submit"], input[type="submit"], button:not([type])',
    )
    if (typeof form.requestSubmit === "function")
      form.requestSubmit(
        button instanceof HTMLButtonElement ? button : undefined,
      )
    else button?.click()
    return
  }
  const button = [
    ...input.ownerDocument.querySelectorAll<HTMLElement>(
      'button, [role="button"], input[type="submit"]',
    ),
  ]
    .filter(isVisible)
    .find(
      (b) =>
        input.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING,
    )
  button?.click()
}

export interface SubmittedLogin {
  username: string
  password: string
  /** Whether the password was typed into a field for a new one, as on sign-up and change-password forms. */
  newPassword: boolean
}

/**
 * The values a login form holds when it is submitted, read from the field the user acted in. A
 * form with a field for a new password gives that one, not the current password a change-password
 * form also asks for. The username may sit in a hidden field marked for it, as such forms are
 * advised to keep one.
 */
export function credentialsAround(element: Element): SubmittedLogin | null {
  const scopes = new Scopes()
  const scope = element instanceof HTMLFormElement ? element : scopeOf(element)
  const inputs = deepInputs(scope).filter((i) => !i.disabled)
  const filled = inputs.filter((i) => isPasswordField(i) && i.value)
  const fresh = filled.find((i) => scopes.isNewPassword(i))
  const password = fresh ?? filled[0]
  if (password) {
    const marked = inputs.find(
      (i) =>
        i.type !== "password" &&
        /\b(username|email)\b/i.test(i.getAttribute("autocomplete") ?? "") &&
        i.value.trim(),
    )
    return {
      username: (scopes.usernameFor(password) ?? marked)?.value.trim() ?? "",
      password: password.value,
      newPassword: fresh !== undefined,
    }
  }
  if (inputs.some(isPasswordField)) return null
  const username = inputs.find(
    (i) => usable(i) && looksLikeUsername(i) && i.value.trim(),
  )
  return username
    ? { username: username.value.trim(), password: "", newPassword: false }
    : null
}

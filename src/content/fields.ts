/**
 * Finding login fields in a page and filling them. Fields inside open shadow roots count too, as
 * web components put them there; a login form is the nearest `<form>` across shadow boundaries.
 */

const TEXT_TYPES = new Set(["text", "email", "tel", ""])
const USERNAME_HINT =
  /user|email|e-mail|login|account|identifier|phone|mobile|账号|帳號|用户|手机|邮箱/i
const EXCLUDED_HINT =
  /search|captcha|otp|one-time|verification|code|coupon|promo|card|cvv|zip|postal|address/i
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
const NEW_PASSWORD_HINT =
  /new|confirm|repeat|retype|again|register|sign-?up|create|新密码|新密碼|确认|確認|重复|重複|再次/i

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

function isNewPassword(input: HTMLInputElement): boolean {
  return /new-password/.test(input.autocomplete)
}

function hints(input: HTMLInputElement): string {
  return [
    input.name,
    input.id,
    input.placeholder,
    input.getAttribute("aria-label") ?? "",
  ].join(" ")
}

function hasCodeAutocomplete(input: HTMLInputElement): boolean {
  return /\bone-time-code\b/.test(input.autocomplete.toLowerCase())
}

function isTextField(input: HTMLInputElement): boolean {
  return (
    TEXT_TYPES.has(input.type) &&
    !hasCodeAutocomplete(input) &&
    !EXCLUDED_HINT.test(hints(input))
  )
}

/** A text field that looks like it takes a username or email, judged without a password field. */
function looksLikeUsername(input: HTMLInputElement): boolean {
  if (!isTextField(input)) return false
  const autocomplete = input.autocomplete.toLowerCase()
  if (/\b(username|email)\b/.test(autocomplete)) return true
  if (
    autocomplete.includes("new-password") ||
    autocomplete.includes("one-time-code")
  )
    return false
  return input.type === "email" || USERNAME_HINT.test(hints(input))
}

/** A field for a one-time code from an authenticator. */
function isCodeField(input: HTMLInputElement): boolean {
  if (!CODE_TYPES.has(input.type)) return false
  if (input.maxLength > CODE_MAX_LENGTH) return false
  if (hasCodeAutocomplete(input)) return true
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
   * form has more password fields, as a sign-up form asks twice and a change-password form asks
   * for the current one first.
   */
  isNewPassword(input: HTMLInputElement): boolean {
    const autocomplete = input.autocomplete.toLowerCase()
    if (autocomplete.includes("current-password")) return false
    if (isNewPassword(input) || NEW_PASSWORD_HINT.test(hints(input)))
      return true
    const passwords = this.inputs(scopeOf(input)).filter(isPasswordField)
    return (
      passwords.length === 2 || (passwords.length > 2 && passwords[0] !== input)
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

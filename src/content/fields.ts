/** Finding login fields in a page and filling them. */

const TEXT_TYPES = new Set(["text", "email", "tel", ""])
const USERNAME_HINT =
  /user|email|e-mail|login|account|identifier|phone|mobile|账号|帳號|用户|手机|邮箱/i
const EXCLUDED_HINT =
  /search|captcha|otp|one-time|verification|code|coupon|promo|card|cvv|zip|postal|address/i

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

function hints(input: HTMLInputElement): string {
  return [
    input.name,
    input.id,
    input.placeholder,
    input.getAttribute("aria-label") ?? "",
  ].join(" ")
}

function isTextField(input: HTMLInputElement): boolean {
  return TEXT_TYPES.has(input.type) && !EXCLUDED_HINT.test(hints(input))
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

function scopeOf(input: HTMLInputElement): ParentNode {
  return input.form ?? input.ownerDocument
}

function inputsIn(scope: ParentNode): HTMLInputElement[] {
  return [...scope.querySelectorAll("input")].filter(usable)
}

/** The text field right before a password field in the same form, which holds the username. */
export function usernameFieldFor(
  password: HTMLInputElement,
): HTMLInputElement | null {
  const inputs = inputsIn(scopeOf(password))
  const index = inputs.indexOf(password)
  for (let i = index - 1; i >= 0; i--) {
    const input = inputs[i]
    if (input && isTextField(input)) return input
  }
  return null
}

/** The first password field after a username field in the same form. */
export function passwordFieldFor(
  username: HTMLInputElement,
): HTMLInputElement | null {
  const inputs = inputsIn(scopeOf(username))
  return (
    inputs.slice(inputs.indexOf(username) + 1).find(isPasswordField) ?? null
  )
}

/**
 * Fields that get the icon: visible password fields, the username field before each, and fields
 * that look like a username on their own, as on the first page of a two-step login.
 */
export function loginFields(root: Document): HTMLInputElement[] {
  const inputs = inputsIn(root)
  const fields = new Set<HTMLInputElement>()
  const passwords = inputs
    .filter(isPasswordField)
    .filter((p) => !/new-password/.test(p.autocomplete))
  for (const password of passwords) {
    fields.add(password)
    const username = usernameFieldFor(password)
    if (username) fields.add(username)
  }
  for (const input of inputs) {
    if (
      !fields.has(input) &&
      looksLikeUsername(input) &&
      !inputsIn(scopeOf(input)).some(isPasswordField)
    ) {
      fields.add(input)
    }
  }
  return [...fields]
}

/** The username and password fields a login for `anchor` goes into. */
export function fillTargets(anchor: HTMLInputElement): {
  username: HTMLInputElement | null
  password: HTMLInputElement | null
} {
  if (isPasswordField(anchor))
    return { username: usernameFieldFor(anchor), password: anchor }
  return { username: anchor, password: passwordFieldFor(anchor) }
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
  input.dispatchEvent(new Event("change", { bubbles: true }))
}

/** Submits the form of a filled field, or clicks the nearby submit button when there is no form. */
export function submitFor(input: HTMLInputElement): void {
  const form = input.form
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

/** The values a login form holds when it is submitted, read from the field the user acted in. */
export function credentialsAround(
  element: Element,
): { username: string; password: string } | null {
  const scope: ParentNode =
    element instanceof HTMLFormElement
      ? element
      : ((element.closest("form") as HTMLFormElement | null) ??
        element.ownerDocument)
  const inputs = [...scope.querySelectorAll("input")].filter((i) => !i.disabled)
  const password =
    inputs.find(
      (i) =>
        isPasswordField(i) && i.value && !/new-password/.test(i.autocomplete),
    ) ?? inputs.find((i) => isPasswordField(i) && i.value)
  if (password) {
    return {
      username: usernameFieldFor(password)?.value.trim() ?? "",
      password: password.value,
    }
  }
  if (inputs.some(isPasswordField)) return null
  const username = inputs.find(
    (i) => usable(i) && looksLikeUsername(i) && i.value.trim(),
  )
  return username ? { username: username.value.trim(), password: "" } : null
}

import { deepInputs, scopeOf } from "./deep-dom"
import { FieldIndex, isFillable } from "./field-finder"
import {
  hasAutocomplete,
  hintWords,
  isDecoyField,
  isPasswordField,
  looksLikeUsername,
} from "./field-hints"
import { buttonGroupOf } from "./form-kind"

/** Words of a hidden field's names that hold the account a password step is for. */
const HIDDEN_ACCOUNT_HINT = /\b(user ?name|e-?mail|identifier|login)\b/i
/** Words of hidden fields that hold an internal ID or a token rather than the account. */
const NOT_ACCOUNT_HINT =
  /\b(id|token|csrf|nonce|hash|key|session|redirect|url)\b/i
/** Text this long or shorter, such as "Signed in as …", may name the account; longer text is prose. */
const MAX_ACCOUNT_TEXT = 70
const EMAIL_ADDRESS = /[^\s@<>()",;:]+@[a-z\d-]+(\.[a-z\d-]+)+/i
/** Elements whose text does not name the account, such as a link to a support address. */
const NOT_ACCOUNT_TEXT = "a, script, style, noscript"
/** Characters a page masks part of an address with, as in "u***@example.com". */
const MASK = /[*•·]/
/** Longer values are not a username. */
const MAX_USERNAME_LENGTH = 256

export interface SubmittedLogin {
  username: string
  password: string
  /** Whether the password was typed into a field for a new one, as on sign-up and change-password forms. */
  newPassword: boolean
  /**
   * The account a password step names without a field for it, given only when `username` is
   * empty; the background prefers the username the tab used on the step before.
   */
  usernameOnPage?: string
}

/** Whether `node` comes after `field` in the same tree. */
function follows(node: Node, field: HTMLInputElement): boolean {
  const position = node.compareDocumentPosition(field)
  return (
    !(position & Node.DOCUMENT_POSITION_DISCONNECTED) &&
    (position & Node.DOCUMENT_POSITION_PRECEDING) !== 0
  )
}

/**
 * The account a form's password step names without a field for it, after DuckDuckGo's autofill:
 * an email address in a hidden field named for it, else one in the short texts before the password
 * field, within its form or the elements its buttons are in, such as "Signed in as
 * user@example.com". Hidden fields named for a login also hold flags such as `login_type=password`,
 * and links and text after the field give addresses for help, so neither counts. Masked addresses
 * are passed over. Empty when there is none.
 */
function usernameOnPage(
  password: HTMLInputElement,
  inputs: readonly HTMLInputElement[],
): string {
  const hidden = inputs.find((input) => {
    if (input.type !== "hidden") return false
    const words = hintWords(input)
    return HIDDEN_ACCOUNT_HINT.test(words) && !NOT_ACCOUNT_HINT.test(words)
  })
  const hiddenValue = hidden?.value.trim() ?? ""
  if (
    hiddenValue.length <= MAX_USERNAME_LENGTH &&
    hiddenValue.match(EMAIL_ADDRESS)?.[0] === hiddenValue
  )
    return hiddenValue
  const group = buttonGroupOf(password)
  if (!group) return ""
  const walker = document.createTreeWalker(group, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (follows(node, password)) break
    if (node.parentElement?.closest(NOT_ACCOUNT_TEXT)) continue
    const text = (node.textContent ?? "").trim()
    if (text.length > MAX_ACCOUNT_TEXT) continue
    const address = text.match(EMAIL_ADDRESS)?.[0]
    if (address && !MASK.test(address)) return address
  }
  return ""
}

/**
 * The values a login form holds when it is submitted, read from the field the user acted in. A
 * form with a field for a new password gives that one, not the current password a change-password
 * form also asks for. The username may sit in a hidden field marked for it, as such forms are
 * advised to keep one, or only show on the page; see `usernameOnPage`.
 */
export function credentialsAround(element: Element): SubmittedLogin | null {
  const index = new FieldIndex()
  const scope = element instanceof HTMLFormElement ? element : scopeOf(element)
  const inputs = deepInputs(scope).filter(
    (input) => !input.disabled && !isDecoyField(input),
  )
  const filled = inputs.filter((input) => isPasswordField(input) && input.value)
  const fresh = filled.find((input) => index.isNewPassword(input))
  const password = fresh ?? filled[0]
  if (password) {
    const marked = inputs.find(
      (input) =>
        input.type !== "password" &&
        (hasAutocomplete(input, "username") ||
          hasAutocomplete(input, "email")) &&
        input.value.trim(),
    )
    const username = (index.usernameFor(password) ?? marked)?.value.trim() ?? ""
    const login: SubmittedLogin = {
      username,
      password: password.value,
      newPassword: fresh !== undefined,
    }
    const shown = username ? "" : usernameOnPage(password, inputs)
    if (shown) login.usernameOnPage = shown
    return login
  }
  if (inputs.some(isPasswordField)) return null
  const username = inputs.find(
    (input) =>
      isFillable(input) && looksLikeUsername(input) && input.value.trim(),
  )
  return username
    ? { username: username.value.trim(), password: "", newPassword: false }
    : null
}

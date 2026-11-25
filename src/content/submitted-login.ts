import { deepInputs, scopeOf } from "./deep-dom"
import { FieldIndex, isFillable } from "./field-finder"
import {
  hasAutocomplete,
  isPasswordField,
  looksLikeUsername,
} from "./field-hints"

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
  const index = new FieldIndex()
  const scope = element instanceof HTMLFormElement ? element : scopeOf(element)
  const inputs = deepInputs(scope).filter((input) => !input.disabled)
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
    return {
      username: (index.usernameFor(password) ?? marked)?.value.trim() ?? "",
      password: password.value,
      newPassword: fresh !== undefined,
    }
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

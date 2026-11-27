/** What a field's type, autocomplete values, name and labels say it takes. */

const TEXT_TYPES = new Set(["text", "email", "tel", ""])
/** Words of a field for an account name or email; a phone number is told apart by `PHONE_HINT`. */
const ACCOUNT_HINT =
  /user|email|e-mail|login|account|identifier|账号|帳號|用户|邮箱|邮件|郵件/i
const PHONE_HINT = /phone|mobile|手机/i
/** "address" counts as a postal address unless it follows "mail", as in "Email address" and "mailAddress". */
const EXCLUDED_HINT =
  /search|filter|title|captcha|otp|one-time|verification|coupon|promo|cvv|zip|postal|(?<!mail[\s_.-]*)address|验证码|驗證碼/i
/**
 * Words of a code or a card number. A field named so is rarely a login on its own, but banks and
 * schools sign in with one before the password, as in "Card number" or "Person code".
 */
const CODE_OR_CARD_HINT = /code|card/i
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
  /^(name|honorific-\w+|given-name|additional-name|family-name|nickname|organization(-title)?|street-address|address-\w+|country(-name)?|postal-code|cc-[\w-]+|transaction-\w+|language|bday(-\w+)?|sex|url|photo|impp|tel-(country-code|area-code|national|local(-\w+)?|extension))$/
/** Autocomplete sections for checkout forms, whose email and phone are not a login. */
const CHECKOUT_AUTOCOMPLETE = new Set(["billing", "shipping"])
/**
 * Words that name a field for a new password, matched against `hintWords` and label text, so
 * English words stand apart. The Italian, Spanish, French, German and Dutch words for "new" come
 * from DuckDuckGo's autofill.
 */
const NEW_PASSWORD_HINT =
  /\b(new|create|choose|set|nuova|nueva|nuevo|nouveau|nouvelle|neues|nieuw)\b|新密码|新密碼|设置密码|設定密碼/i
/**
 * Words of a field's attributes for a sign-up's password. A label may use them on a sign-in form
 * too, as in "the password used to sign up", so labels are not matched against them.
 */
const SIGN_UP_HINT = /\b(register|registration|sign ?up)\b/i
const CONFIRM_PASSWORD_HINT =
  /\b(confirm|confirmation|repeat|retype|again|verify)\b|确认|確認|重复|重複|再次/i
const CURRENT_PASSWORD_HINT =
  /\b(current|old|existing|previous)\b|当前|目前|旧密码|舊密碼|原密码|原密碼/i

/**
 * Words of a password-type field that takes another secret: a card code, tax or social security
 * number, security answer or one-time code. Matched against `hintWords`. A PIN is left out, as
 * some sites call the password one.
 */
const OTHER_SECRET_HINT =
  /\b(cvv2?|cvc|csc|tin|ssn)\d*\b|card|social security|answer|mfa|one-?time|\botp/i
/** Words that name a password, which keep a field one even when it also names another secret. */
const PASSWORD_WORD_HINT =
  /password|passwort|contraseña|mot de passe|密码|密碼/i
/** Matched against `hintWords`: the parts of a person's name, which forms may ask for beside a login. */
export const NAME_PART_HINT =
  /\b(first|last|given|family|middle|sur) ?name\b|\b[fl]name\b|名字|姓氏/i

/**
 * Password-type fields seen so far, which stay password fields while the page shows them in plain
 * text.
 */
const seenPasswordFields = new WeakSet<HTMLInputElement>()

/**
 * A field that takes a password: a password-type field, or one that was until its page showed the
 * password in plain text, that is not marked or named for another secret that only hides like
 * one, such as a card's security code, nor a one-character box of a PIN or code. A text field is
 * not taken for one by its names or marks, which pages also put on fields that hold no password.
 */
export function isPasswordField(
  element: EventTarget | null,
): element is HTMLInputElement {
  return element instanceof HTMLInputElement && takesPassword(element)
}

function takesPassword(input: HTMLInputElement): boolean {
  if (input.type === "password") seenPasswordFields.add(input)
  else if (input.type !== "text" || !seenPasswordFields.has(input)) return false
  if (input.maxLength === 1) return false
  if (marksOtherData(input) || hasCodeAutocomplete(input)) return false
  const words = hintWords(input)
  return !OTHER_SECRET_HINT.test(words) || PASSWORD_WORD_HINT.test(words)
}

/**
 * Original `autocomplete` attributes saved while Keyward temporarily overrides them to `"off"`
 * (to suppress the browser's own autofill dropdown while the inline menu is open).
 */
const suppressedAutocomplete = new WeakMap<HTMLInputElement, string | null>()

/**
 * Temporarily overrides `input`'s `autocomplete` attribute to `"off"` while keeping the page's
 * value readable by `field-hints` so re-scans and submission inspection see the real attribute.
 */
export function suppressFieldAutocomplete(input: HTMLInputElement): void {
  if (!suppressedAutocomplete.has(input))
    suppressedAutocomplete.set(input, input.getAttribute("autocomplete"))
  input.setAttribute("autocomplete", "off")
}

/** Restores an `autocomplete` attribute previously overridden by `suppressFieldAutocomplete`. */
export function restoreFieldAutocomplete(input: HTMLInputElement): void {
  if (!suppressedAutocomplete.has(input)) return
  const original = suppressedAutocomplete.get(input) ?? null
  suppressedAutocomplete.delete(input)
  if (input.getAttribute("autocomplete") !== "off") return
  if (original === null) input.removeAttribute("autocomplete")
  else input.setAttribute("autocomplete", original)
}

/**
 * The field's autocomplete values in lower case, such as `billing` and `email`; the HTML standard
 * ignores case. Uses the saved page value while Keyward temporarily sets `autocomplete="off"`.
 */
function autocompleteValues(input: HTMLInputElement): string[] {
  const live = input.getAttribute("autocomplete")
  const attribute =
    live === "off" && suppressedAutocomplete.has(input)
      ? (suppressedAutocomplete.get(input) ?? "")
      : (live ?? "")
  return attribute.toLowerCase().split(/\s+/).filter(Boolean)
}

export function hasAutocomplete(
  input: HTMLInputElement,
  value: string,
): boolean {
  return autocompleteValues(input).includes(value)
}

/** Whether the page marks the field for something other than a login, such as an address or a card. */
export function marksOtherData(input: HTMLInputElement): boolean {
  return autocompleteValues(input).some(
    (value) =>
      CHECKOUT_AUTOCOMPLETE.has(value) || OTHER_DATA_AUTOCOMPLETE.test(value),
  )
}

/** Whether the page marks the field for a new password; the field's names may still say otherwise. */
export function marksNewPassword(input: HTMLInputElement): boolean {
  return hasAutocomplete(input, "new-password")
}

export function hasCodeAutocomplete(input: HTMLInputElement): boolean {
  return hasAutocomplete(input, "one-time-code")
}

/**
 * Whether `text` merely repeats what the user already typed into `input` (as inline-editable
 * titles do when mirroring their text into `aria-label`).
 */
export function isInputOwnValue(
  input: HTMLInputElement,
  text: string | null | undefined,
): boolean {
  const value = input.value.trim()
  if (!value || !text) return false
  return text.trim().toLowerCase() === value.toLowerCase()
}

function hintText(input: HTMLInputElement): string {
  const ariaLabel = input.getAttribute("aria-label")
  return [
    input.name,
    input.id,
    input.placeholder,
    isInputOwnValue(input, ariaLabel) ? "" : (ariaLabel ?? ""),
  ].join(" ")
}

/** Label text beyond this length holds more than the field's name. */
const MAX_LABEL_LENGTH = 100

/** The field's hint text with camelCase, underscores and dashes split into words. */
export function hintWords(input: HTMLInputElement): string {
  return hintText(input)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-.[\]]+/g, " ")
}

/**
 * `hintWords` with the text of the field's short labels, where a password field often says what
 * it takes, as in "Create password" or "Nuova password".
 */
function wordsWithLabels(input: HTMLInputElement): string {
  const labels = [...(input.labels ?? [])]
    .map((label) => (label.textContent ?? "").replace(/\s+/g, " ").trim())
    .filter(
      (text) =>
        text.length <= MAX_LABEL_LENGTH && !isInputOwnValue(input, text),
    )
  return [hintWords(input), ...labels].join(" ")
}

/** Whether a password field's names or labels say it takes a new password. */
export function namesNewPassword(input: HTMLInputElement): boolean {
  return (
    NEW_PASSWORD_HINT.test(wordsWithLabels(input)) ||
    SIGN_UP_HINT.test(hintWords(input))
  )
}

/** Whether a password field's names or labels say it takes the current password. */
export function namesCurrentPassword(input: HTMLInputElement): boolean {
  return CURRENT_PASSWORD_HINT.test(wordsWithLabels(input))
}

/** Whether a password field's names or labels say it confirms the one before it. */
export function namesConfirmation(input: HTMLInputElement): boolean {
  return CONFIRM_PASSWORD_HINT.test(wordsWithLabels(input))
}

/**
 * Whether the page marks the field for a username or email. `webauthn` marks the field a page
 * offers passkeys on, which is where a username goes.
 */
function marksUsername(input: HTMLInputElement): boolean {
  const values = autocompleteValues(input)
  return ["username", "email", "webauthn"].some((value) =>
    values.includes(value),
  )
}

/**
 * Whether a field takes text that may be a username. The page's mark for a username overrules
 * the words of the field's names, and lets in a search field that carries it. A password the page
 * shows in plain text is left out.
 */
export function isTextField(input: HTMLInputElement): boolean {
  if (hasCodeAutocomplete(input) || marksOtherData(input)) return false
  if (takesPassword(input)) return false
  if (marksUsername(input))
    return TEXT_TYPES.has(input.type) || input.type === "search"
  return TEXT_TYPES.has(input.type) && !EXCLUDED_HINT.test(hintText(input))
}

/** A text field that looks like it takes a username or email, judged without a password field. */
export function looksLikeUsername(input: HTMLInputElement): boolean {
  if (!isTextField(input)) return false
  if (marksUsername(input)) return true
  if (marksNewPassword(input)) return false
  const text = hintText(input)
  if (CODE_OR_CARD_HINT.test(text)) return false
  return (
    input.type === "email" || ACCOUNT_HINT.test(text) || PHONE_HINT.test(text)
  )
}

/** Whether a field that looks like a username does so only as a phone number, which other forms ask for too. */
export function suggestsOnlyPhone(input: HTMLInputElement): boolean {
  if (marksUsername(input) || input.type === "email") return false
  const text = hintText(input)
  return PHONE_HINT.test(text) && !ACCOUNT_HINT.test(text)
}

/** Fields named "fake…" are decoys that pages keep out of sight to catch the browser's own autofill. */
export function isDecoyField(input: HTMLInputElement): boolean {
  return /^fake/i.test(input.name)
}

/** A field for a one-time code from an authenticator. */
export function isCodeField(input: HTMLInputElement): boolean {
  if (!CODE_TYPES.has(input.type)) return false
  if (input.maxLength > CODE_MAX_LENGTH) return false
  if (hasCodeAutocomplete(input)) return true
  if (marksOtherData(input)) return false
  const text = hintText(input)
  return CODE_HINT.test(text) && !NOT_AUTHENTICATOR_HINT.test(text)
}

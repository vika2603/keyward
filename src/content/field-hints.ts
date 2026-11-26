/** What a field's type, autocomplete values, name and labels say it takes. */

const TEXT_TYPES = new Set(["text", "email", "tel", ""])
/** Words of a field for an account name or email; a phone number is told apart by `PHONE_HINT`. */
const ACCOUNT_HINT =
  /user|email|e-mail|login|account|identifier|账号|帳號|用户|邮箱|邮件|郵件/i
const PHONE_HINT = /phone|mobile|手机/i
/** "address" counts as a postal address unless it follows "mail", as in "Email address" and "mailAddress". */
const EXCLUDED_HINT =
  /search|filter|title|captcha|otp|one-time|verification|code|coupon|promo|card|cvv|zip|postal|(?<!mail[\s_.-]*)address|验证码|驗證碼/i
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
/** Matched against `hintWords`, so English words stand apart. */
export const NEW_PASSWORD_HINT =
  /\b(new|register|registration|sign ?up|create)\b|新密码|新密碼|设置密码|設定密碼/i
export const CONFIRM_PASSWORD_HINT =
  /\b(confirm|confirmation|repeat|retype|again|verify)\b|确认|確認|重复|重複|再次/i
export const CURRENT_PASSWORD_HINT =
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
 * A field that takes a password: a password-type field that is not marked or named for another
 * secret that only hides like one, such as a card's security code, nor a one-character box of a
 * PIN or code.
 */
export function isPasswordField(
  element: EventTarget | null,
): element is HTMLInputElement {
  if (!(element instanceof HTMLInputElement) || element.type !== "password")
    return false
  if (element.maxLength === 1) return false
  if (marksOtherData(element) || hasCodeAutocomplete(element)) return false
  const words = hintWords(element)
  return !OTHER_SECRET_HINT.test(words) || PASSWORD_WORD_HINT.test(words)
}

/** The field's autocomplete values in lower case, such as `billing` and `email`; the HTML standard ignores case. */
function autocompleteValues(input: HTMLInputElement): string[] {
  const attribute = input.getAttribute("autocomplete") ?? ""
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

function hintText(input: HTMLInputElement): string {
  return [
    input.name,
    input.id,
    input.placeholder,
    input.getAttribute("aria-label") ?? "",
  ].join(" ")
}

/** The field's hint text with camelCase, underscores and dashes split into words. */
export function hintWords(input: HTMLInputElement): string {
  return hintText(input)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-.[\]]+/g, " ")
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
 * the words of the field's names, and lets in a search field that carries it.
 */
export function isTextField(input: HTMLInputElement): boolean {
  if (hasCodeAutocomplete(input) || marksOtherData(input)) return false
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

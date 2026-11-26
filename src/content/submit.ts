import type { ContentScriptContext } from "wxt/utils/content-script-context"
import { deepActiveElement, deepInputs, eventOrigin, scopeOf } from "./deep-dom"
import { isFillable } from "./field-finder"
import { isPasswordField } from "./field-hints"
import { credentialsAround, type SubmittedLogin } from "./submitted-login"

const DEDUPE_MS = 3000
/** Labels of controls that send a sign-in, sign-up or one of their steps. */
const SUBMIT_LABEL =
  /log ?in|sign ?in|sign ?up|register|create( an| my| your)? account|join|submit|continue|next|登录|登入|登陆|注册|註冊|提交|继续|下一步|確認|确认/i
/**
 * Elements that may act as a submit control: buttons and inputs, and the links and styled
 * elements pages turn into buttons with a script.
 */
const CONTROL_SELECTOR =
  'button, input, [role="button"], a[href="#"], a[href^="javascript:"], [onclick], [class*="button" i], [class*="btn" i]'
/** A longer text is a part of the page around a control rather than its label. */
const MAX_SCRIPTED_LABEL_LENGTH = 25
/** Paths of the requests a script sends to sign in, after DuckDuckGo's autofill. */
const SIGN_IN_REQUEST_PATH = /log-?in|sign-?in|log_in|sign_in|logon/i
const SCRIPT_REQUESTS = new Set(["fetch", "xmlhttprequest"])

/** Whether a resource the page loaded is a request its script sent to sign in. */
export function isSignInRequest(entry: PerformanceEntry): boolean {
  const { initiatorType } = entry as PerformanceResourceTiming
  if (!SCRIPT_REQUESTS.has(initiatorType)) return false
  try {
    return SIGN_IN_REQUEST_PATH.test(new URL(entry.name).pathname)
  } catch {
    return false
  }
}

/**
 * The filled password field a script's sign-in request sent, or null while the focus is still in
 * a field of its form, where the user may not have finished typing.
 */
function sentPasswordField(): HTMLInputElement | null {
  const password = deepInputs(document).find(
    (input) => isPasswordField(input) && input.value && isFillable(input),
  )
  if (!password) return null
  const focused = deepActiveElement()
  const stillTyping =
    focused instanceof HTMLInputElement &&
    scopeOf(focused) === scopeOf(password)
  return stillTyping ? null : password
}

/** The control a click on `target` presses, when it is one that submits a login form. */
export function submitControlOf(target: Element): HTMLElement | null {
  const control = target.closest(CONTROL_SELECTOR)
  if (!(control instanceof HTMLElement)) return null
  return isSubmitControl(control) ? control : null
}

function isSubmitControl(control: HTMLElement): boolean {
  if (control instanceof HTMLInputElement)
    return (
      control.type === "submit" ||
      control.type === "image" ||
      (control.type === "button" && SUBMIT_LABEL.test(control.value))
    )
  const label = (control.textContent ?? "").replace(/\s+/g, " ").trim()
  if (control instanceof HTMLButtonElement)
    return control.type === "submit" || SUBMIT_LABEL.test(label)
  if (control.getAttribute("role") === "button") return SUBMIT_LABEL.test(label)
  return label.length <= MAX_SCRIPTED_LABEL_LENGTH && SUBMIT_LABEL.test(label)
}

/**
 * Reports login forms the user submits, read when the form is submitted, a submit control is
 * clicked or Enter is pressed in a field, all only from the user, or when the page's script sends
 * a request to sign in once the user has left a form with a filled password. Pages that sign in
 * some other way are missed. Nothing is read while `active` returns false.
 */
export function watchSubmissions(
  ctx: ContentScriptContext,
  active: () => boolean,
  report: (credentials: SubmittedLogin) => void,
): void {
  let lastReport = { key: "", at: 0 }
  const reportCredentialsAround = (element: Element) => {
    if (!active()) return
    const credentials = credentialsAround(element)
    if (!credentials || (!credentials.username && !credentials.password)) return
    const key = `${credentials.username}\n${credentials.password}`
    if (key === lastReport.key && Date.now() - lastReport.at < DEDUPE_MS) return
    lastReport = { key, at: Date.now() }
    report(credentials)
  }

  ctx.addEventListener(
    document,
    "submit",
    (event) => {
      const form = eventOrigin(event)
      if (event.isTrusted && form instanceof HTMLFormElement)
        reportCredentialsAround(form)
    },
    { capture: true },
  )
  ctx.addEventListener(
    document,
    "click",
    (event) => {
      const target = eventOrigin(event)
      if (!event.isTrusted || !(target instanceof Element)) return
      const control = submitControlOf(target)
      if (control) reportCredentialsAround(control)
    },
    { capture: true },
  )
  ctx.addEventListener(
    document,
    "keydown",
    (event) => {
      if (!event.isTrusted || event.key !== "Enter" || event.isComposing) return
      const target = eventOrigin(event)
      if (target instanceof HTMLInputElement && target.type !== "hidden")
        reportCredentialsAround(target)
    },
    { capture: true },
  )
  // The entry of a request comes once its response has.
  const requests = new PerformanceObserver((list) => {
    if (!active() || !list.getEntries().some(isSignInRequest)) return
    const password = sentPasswordField()
    if (password) reportCredentialsAround(password)
  })
  requests.observe({ type: "resource" })
  ctx.onInvalidated(() => requests.disconnect())
}

import type { ContentScriptContext } from "wxt/utils/content-script-context"
import { eventOrigin } from "./deep-dom"
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
 * clicked or Enter is pressed in a field. Only events from the user count; pages that sign in
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
}

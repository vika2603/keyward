import type { ContentScriptContext } from "wxt/utils/content-script-context"
import { eventOrigin } from "./deep-dom"
import type { PageEvents } from "./page-events"
import { credentialsAround, type SubmittedLogin } from "./submitted-login"

const DEDUPE_MS = 3000
/**
 * Labels of controls that send a sign-in, sign-up or one of their steps, in the languages most
 * sites use. Words that end in a letter outside ASCII stay out of the `\b` group, as `\b` knows
 * only ASCII letters.
 */
const SUBMIT_LABEL =
  /\b(log ?in|sign ?in|sign (me )?up|register|create( an| my| your)? account|join|submit|continue|next|anmelden|einloggen|registrieren|weiter|connexion|se connecter|s'identifier|s'inscrire|continuer|suivant|iniciar sesión|entrar|acceder|registrarse|continuar|siguiente|accedi|registrati|continua|avanti|inloggen|aanmelden|doorgaan|volgende|zaloguj|dalej)\b|giriş|войти|вход|далее|продолжить|ログイン|サインイン|次へ|로그인|다음|登录|登入|登陆|注册|註冊|提交|继续|下一步|確認|确认/i
/** Labels that ask a question or offer help, as the links beside a sign-in form do: "Can't log in?" */
const HELP_LABEL =
  /[?？]|\b(forgot|help|trouble|can['’]?t|cannot)\b|忘记|忘記|帮助|幫助/i
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
/** How soon after the user presses a control the sign-in request it sends starts. */
const REQUEST_AFTER_PRESS_MS = 2000
/**
 * A path requested again this soon is polled, as a QR-code sign-in polls for the scan, rather than
 * sent once to sign in.
 */
const POLL_INTERVAL_MS = 10_000

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

/** The control a click on `target` presses, when it is one that submits a login form. */
export function submitControlOf(target: Element): HTMLElement | null {
  const control = pressedControlOf(target)
  return control && isSubmitControl(control) ? control : null
}

/** The control a click on `target` presses, other than a field the user types or ticks in. */
function pressedControlOf(target: Element): HTMLElement | null {
  const control = target.closest(CONTROL_SELECTOR)
  if (!(control instanceof HTMLElement)) return null
  if (
    control instanceof HTMLInputElement &&
    !["submit", "image", "button"].includes(control.type)
  )
    return null
  return control
}

function isSubmitControl(control: HTMLElement): boolean {
  if (control instanceof HTMLInputElement)
    return control.type !== "button" || sendsLogin(control.value)
  const label = (control.textContent ?? "").replace(/\s+/g, " ").trim()
  if (control instanceof HTMLButtonElement)
    return control.type === "submit" || sendsLogin(label)
  if (control.getAttribute("role") === "button") return sendsLogin(label)
  return label.length <= MAX_SCRIPTED_LABEL_LENGTH && sendsLogin(label)
}

function sendsLogin(label: string): boolean {
  return SUBMIT_LABEL.test(label) && !HELP_LABEL.test(label)
}

/**
 * Calls `onSent` with the start time of each sign-in request the page's script sends, passing over
 * the requests of a path the page polls.
 */
function watchSignInRequests(
  ctx: ContentScriptContext,
  onSent: (startTime: number) => void,
): void {
  const lastStarts = new Map<string, number>()
  // The entry of a request comes once its response has.
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (!isSignInRequest(entry)) continue
      const path = new URL(entry.name).pathname
      const lastStart = lastStarts.get(path)
      lastStarts.set(path, entry.startTime)
      const polled =
        lastStart !== undefined &&
        Math.abs(entry.startTime - lastStart) < POLL_INTERVAL_MS
      if (!polled) onSent(entry.startTime)
    }
  })
  observer.observe({ type: "resource" })
  ctx.onInvalidated(() => observer.disconnect())
}

/**
 * Reports login forms the user submits, read when the form is submitted, a submit control is
 * clicked or Enter is pressed in a field, all only from the user, or when the page's script sends
 * a request to sign in right after the user pressed another control, such as a button with only
 * an icon. Pages that sign in some other way are missed. Nothing is read while `active` returns
 * false.
 */
export function watchSubmissions(
  ctx: ContentScriptContext,
  events: PageEvents,
  active: () => boolean,
  report: (credentials: SubmittedLogin) => void,
): void {
  let lastReport = { key: "", at: 0 }
  /** The last control the user pressed that is not a submit control, and when, by `performance.now()`. */
  let lastPress: { control: HTMLElement; at: number } | null = null
  const reportCredentialsAround = (element: Element) => {
    if (!active()) return
    const credentials = credentialsAround(element)
    if (!credentials || (!credentials.username && !credentials.password)) return
    const key = `${credentials.username}\n${credentials.password}`
    if (key === lastReport.key && Date.now() - lastReport.at < DEDUPE_MS) return
    lastReport = { key, at: Date.now() }
    report(credentials)
  }

  events.on(
    "submit",
    (event) => {
      const form = eventOrigin(event)
      if (event.isTrusted && form instanceof HTMLFormElement)
        reportCredentialsAround(form)
    },
    { capture: true },
  )
  events.on(
    "click",
    (event) => {
      const target = eventOrigin(event)
      if (!event.isTrusted || !(target instanceof Element)) return
      const control = pressedControlOf(target)
      if (control && isSubmitControl(control)) {
        lastPress = null
        reportCredentialsAround(control)
      } else {
        lastPress = control && { control, at: performance.now() }
      }
    },
    { capture: true },
  )
  events.on(
    "keydown",
    (event) => {
      if (!event.isTrusted || event.key !== "Enter" || event.isComposing) return
      const target = eventOrigin(event)
      if (target instanceof HTMLInputElement && target.type !== "hidden")
        reportCredentialsAround(target)
    },
    { capture: true },
  )
  watchSignInRequests(ctx, (startTime) => {
    const press = lastPress
    if (
      !press ||
      startTime < press.at ||
      startTime - press.at > REQUEST_AFTER_PRESS_MS
    )
      return
    lastPress = null
    reportCredentialsAround(press.control)
  })
}

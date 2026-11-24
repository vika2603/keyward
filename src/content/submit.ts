import type { ContentScriptContext } from "wxt/utils/content-script-context"
import { credentialsAround, eventOrigin } from "./fields"

const DEDUPE_MS = 3000
const SUBMIT_LIKE =
  /log ?in|sign ?in|submit|continue|next|登录|登入|继续|下一步|確認|确认/i

function isSubmitControl(element: Element | null): element is HTMLElement {
  if (!element) return false
  if (element instanceof HTMLButtonElement)
    return (
      element.type === "submit" || SUBMIT_LIKE.test(element.textContent ?? "")
    )
  if (element instanceof HTMLInputElement)
    return element.type === "submit" || element.type === "image"
  return (
    element.getAttribute("role") === "button" &&
    SUBMIT_LIKE.test(element.textContent ?? "")
  )
}

/**
 * Reports login forms the user submits, read when the form is submitted, a submit control is
 * clicked or Enter is pressed in a field. Only events from the user count; pages that sign in
 * some other way are missed.
 */
export function watchSubmissions(
  ctx: ContentScriptContext,
  report: (credentials: { username: string; password: string }) => void,
): void {
  let last = { key: "", at: 0 }
  const capture = (element: Element) => {
    const credentials = credentialsAround(element)
    if (!credentials || (!credentials.username && !credentials.password)) return
    const key = `${credentials.username}\n${credentials.password}`
    if (key === last.key && Date.now() - last.at < DEDUPE_MS) return
    last = { key, at: Date.now() }
    report(credentials)
  }

  ctx.addEventListener(
    document,
    "submit",
    (event) => {
      const form = eventOrigin(event)
      if (event.isTrusted && form instanceof HTMLFormElement) capture(form)
    },
    { capture: true },
  )
  ctx.addEventListener(
    document,
    "click",
    (event) => {
      const target = eventOrigin(event)
      if (!event.isTrusted || !(target instanceof Element)) return
      const control = target.closest("button, input, [role='button']")
      if (isSubmitControl(control)) capture(control)
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
        capture(target)
    },
    { capture: true },
  )
}

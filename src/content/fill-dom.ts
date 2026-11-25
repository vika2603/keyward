/** Putting values into a page's fields the way typing would, and submitting their form. */

import type { FillField } from "@/lib/providers/types"
import { deepInputs, formOf, scopeOf } from "./deep-dom"
import { codeBoxes, isFillable, isVisible } from "./field-finder"

/** Input types that take neither typed text nor a check mark. */
const NOT_FILLABLE_TYPES = new Set([
  "button",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
])

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

/** Names a page gives a field: its id, name, aria-label, placeholder and label text, in lower case. */
function pageNamesOf(input: HTMLInputElement): string[] {
  const labels = [...(input.labels ?? [])].map(
    (label) => label.textContent ?? "",
  )
  const names = [
    input.id,
    input.name,
    input.getAttribute("aria-label") ?? "",
    input.placeholder,
    ...labels,
  ]
  return names.map((name) => name.trim().toLowerCase()).filter(Boolean)
}

/**
 * Fills a login's custom fields in the form of `anchor`. Each goes into the visible field whose id,
 * name, aria-label, placeholder or label equals the custom field's name, ignoring case, which is how
 * Bitwarden's apps match them. `skip` holds the fields the username and password go into.
 */
export function fillCustomFields(
  anchor: HTMLInputElement,
  fields: readonly FillField[],
  skip: readonly HTMLInputElement[],
): void {
  if (!fields.length) return
  const candidates = deepInputs(scopeOf(anchor)).filter(
    (input) =>
      isFillable(input) &&
      !skip.includes(input) &&
      !NOT_FILLABLE_TYPES.has(input.type),
  )
  for (const field of fields) {
    const name = field.name.trim().toLowerCase()
    const target = candidates.find((input) => pageNamesOf(input).includes(name))
    if (!target) continue
    candidates.splice(candidates.indexOf(target), 1)
    const isCheckbox = target.type === "checkbox"
    if ("checked" in field) {
      // A click changes the box the way the user would, so page frameworks see it.
      if (isCheckbox && target.checked !== field.checked) target.click()
    } else if (!isCheckbox) {
      setFieldValue(target, field.text)
    }
  }
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
      (candidate) =>
        input.compareDocumentPosition(candidate) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    )
  button?.click()
}

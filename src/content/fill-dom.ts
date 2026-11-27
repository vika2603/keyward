/** Putting values into a page's fields the way typing would, and submitting their form. */

import type { FillField } from "@/lib/providers/types"
import {
  composedClosest,
  deepFormControls,
  deepInputs,
  type FormControlElement,
  formOf,
  scopeOf,
} from "./deep-dom"
import { codeBoxes, isFillable, isVisible } from "./field-finder"
import { buttonGroupOf } from "./form-kind"

/** Input types that take neither typed text nor a check/radio choice. */
const NOT_FILLABLE_TYPES = new Set([
  "button",
  "color",
  "file",
  "hidden",
  "image",
  "range",
  "reset",
  "submit",
])

/** Input types a user types into; a search field is left out, as a page header may hold one. */
const TYPED_TYPES = new Set([
  "text",
  "email",
  "tel",
  "password",
  "number",
  "url",
])

const TRUTHY_TEXT = new Set(["true", "1", "yes", "on"])
const FALSY_TEXT = new Set(["false", "0", "no", "off"])

/**
 * Whether a visible field the user types into is still empty beside `field`: in its form, or for a
 * field outside a form, among the elements its buttons are in. Submitting would send it empty,
 * such as a captcha or a code the page asks for with the login.
 */
export function leavesFieldEmpty(field: HTMLInputElement): boolean {
  const group = buttonGroupOf(field) ?? field.ownerDocument
  return deepInputs(group).some(
    (input) => TYPED_TYPES.has(input.type) && !input.value && isFillable(input),
  )
}

function assignNativeValue(
  control: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  const prototype =
    control instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set
  if (setter) setter.call(control, value)
  else control.value = value
}

function inputEvent(): Event {
  if (typeof InputEvent === "function")
    return new InputEvent("input", {
      bubbles: true,
      composed: true,
      inputType: "insertText",
    })
  return new Event("input", { bubbles: true, composed: true })
}

function keyEvent(type: "keydown" | "keyup"): Event {
  if (typeof KeyboardEvent === "function")
    return new KeyboardEvent(type, { bubbles: true, composed: true })
  return new Event(type, { bubbles: true, composed: true })
}

/**
 * Sets a value the way typing would, so that page frameworks and validation listeners see the
 * change. Re-applies once if a framework listener resets the value during event dispatch.
 */
export function setFieldValue(
  control: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  control.focus()
  control.dispatchEvent(keyEvent("keydown"))
  assignNativeValue(control, value)
  control.dispatchEvent(inputEvent())
  control.dispatchEvent(keyEvent("keyup"))
  control.dispatchEvent(new Event("change", { bubbles: true, composed: true }))
  if (control.value !== value) {
    assignNativeValue(control, value)
    control.dispatchEvent(inputEvent())
    control.dispatchEvent(
      new Event("change", { bubbles: true, composed: true }),
    )
  }
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

function normalizeLabel(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase()
}

function ariaLabelledByTexts(element: HTMLElement): string[] {
  const ids = (element.getAttribute("aria-labelledby") ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!ids.length) return []
  const root = element.getRootNode() as {
    getElementById?: (id: string) => HTMLElement | null
  }
  const lookup =
    typeof root.getElementById === "function" ? root : element.ownerDocument
  return ids
    .map((id) => normalizeLabel(lookup.getElementById?.(id)?.textContent))
    .filter(Boolean)
}

function labelTextsOf(control: FormControlElement): string[] {
  const labels = [...(control.labels ?? [])].map((label) =>
    normalizeLabel(label.textContent),
  )
  const ariaLabel = normalizeLabel(control.getAttribute("aria-label"))
  return [...labels, ariaLabel, ...ariaLabelledByTexts(control)].filter(Boolean)
}

interface ControlIdentifiers {
  id: string
  name: string
  labels: string[]
  placeholder: string
}

function identifiersOf(control: FormControlElement): ControlIdentifiers {
  return {
    id: normalizeLabel(control.id),
    name: normalizeLabel(control.name),
    labels: labelTextsOf(control),
    placeholder:
      control instanceof HTMLSelectElement
        ? ""
        : normalizeLabel(control.placeholder),
  }
}

type AttributeScope = "any" | "id" | "name" | "label" | "placeholder"

interface FieldMatcher {
  scope: AttributeScope
  matches: (candidate: string) => boolean
}

const SCOPE_PREFIX = /^(id|name|label|placeholder)=(.*)$/i
const VALUE_PREFIX = /^(regex|csv)=(.*)$/i

function parseCustomFieldMatcher(rawName: string): FieldMatcher {
  const trimmed = rawName.trim()
  const scopeMatch = SCOPE_PREFIX.exec(trimmed)
  const scope = (scopeMatch?.[1]?.toLowerCase() ?? "any") as AttributeScope
  const patternText = (scopeMatch?.[2] ?? trimmed).trim()
  const valueMatch = VALUE_PREFIX.exec(patternText)
  const mode = valueMatch?.[1]?.toLowerCase()
  const expr = valueMatch?.[2] ?? patternText

  if (mode === "regex") {
    try {
      const regex = new RegExp(expr, "i")
      return {
        scope,
        matches: (candidate) => Boolean(candidate) && regex.test(candidate),
      }
    } catch {
      return { scope, matches: () => false }
    }
  }
  if (mode === "csv") {
    const allowed = new Set(
      expr
        .split(",")
        .map((part) => normalizeLabel(part))
        .filter(Boolean),
    )
    return { scope, matches: (candidate) => allowed.has(candidate) }
  }
  const exact = normalizeLabel(patternText)
  return {
    scope,
    matches: (candidate) => Boolean(exact) && candidate === exact,
  }
}

function controlMatchesField(
  control: FormControlElement,
  matcher: FieldMatcher,
): boolean {
  const ids = identifiersOf(control)
  switch (matcher.scope) {
    case "id":
      return matcher.matches(ids.id)
    case "name":
      return matcher.matches(ids.name)
    case "label":
      return ids.labels.some(matcher.matches)
    case "placeholder":
      return matcher.matches(ids.placeholder)
    default:
      return (
        matcher.matches(ids.id) ||
        matcher.matches(ids.name) ||
        ids.labels.some(matcher.matches) ||
        matcher.matches(ids.placeholder)
      )
  }
}

function isFillableControl(control: FormControlElement): boolean {
  if (control instanceof HTMLInputElement)
    return isFillable(control) && !NOT_FILLABLE_TYPES.has(control.type)
  if (control instanceof HTMLTextAreaElement)
    return !control.disabled && !control.readOnly && isVisible(control)
  return !control.disabled && isVisible(control)
}

function fillSelectControl(select: HTMLSelectElement, text: string): void {
  const wanted = normalizeLabel(text)
  const match = [...select.options].find(
    (option) =>
      normalizeLabel(option.value) === wanted ||
      normalizeLabel(option.textContent) === wanted,
  )
  if (!match) return
  select.focus()
  select.value = match.value
  select.dispatchEvent(new Event("input", { bubbles: true, composed: true }))
  select.dispatchEvent(new Event("change", { bubbles: true, composed: true }))
}

function fillRadioControl(
  target: HTMLInputElement,
  field: FillField,
  candidates: readonly FormControlElement[],
): void {
  if ("checked" in field) {
    if (field.checked && !target.checked) target.click()
    return
  }
  const wanted = normalizeLabel(field.text)
  const group = target.name
    ? candidates.filter(
        (candidate): candidate is HTMLInputElement =>
          candidate instanceof HTMLInputElement &&
          candidate.type === "radio" &&
          candidate.name === target.name,
      )
    : [target]
  const match = group.find(
    (radio) =>
      normalizeLabel(radio.value) === wanted ||
      labelTextsOf(radio).includes(wanted),
  )
  if (match && !match.checked) match.click()
}

function desiredCheckboxState(field: FillField): boolean | null {
  if ("checked" in field) return field.checked
  const text = normalizeLabel(field.text)
  if (TRUTHY_TEXT.has(text)) return true
  if (FALSY_TEXT.has(text)) return false
  return null
}

function applyCustomField(
  target: FormControlElement,
  field: FillField,
  allCandidates: readonly FormControlElement[],
): void {
  if (target instanceof HTMLSelectElement) {
    if ("text" in field) fillSelectControl(target, field.text)
    return
  }
  if (target instanceof HTMLTextAreaElement) {
    if ("text" in field) setFieldValue(target, field.text)
    return
  }
  if (target.type === "checkbox") {
    const desired = desiredCheckboxState(field)
    // A click changes the box the way the user would, so page frameworks see it.
    if (desired !== null && target.checked !== desired) target.click()
    return
  }
  if (target.type === "radio") {
    fillRadioControl(target, field, allCandidates)
    return
  }
  if ("text" in field) setFieldValue(target, field.text)
}

/**
 * Fills a login's custom fields in the form of `anchor`. Supports `<input>`, `<select>` and
 * `<textarea>`, Bitwarden's `id=`/`name=`/`label=`/`placeholder=` attribute prefixes, and
 * `regex=`/`csv=` value matchers. `skip` holds the fields the username and password go into.
 */
export function fillCustomFields(
  anchor: HTMLInputElement,
  fields: readonly FillField[],
  skip: readonly HTMLInputElement[],
): void {
  if (!fields.length) return
  const allCandidates = deepFormControls(scopeOf(anchor)).filter(
    (control) =>
      isFillableControl(control) &&
      !(control instanceof HTMLInputElement && skip.includes(control)),
  )
  const remaining = [...allCandidates]
  for (const field of fields) {
    const matcher = parseCustomFieldMatcher(field.name)
    const target = remaining.find((control) =>
      controlMatchesField(control, matcher),
    )
    if (!target) continue
    remaining.splice(remaining.indexOf(target), 1)
    applyCustomField(target, field, allCandidates)
  }
}

/**
 * The most stable identifier of an editable control for configuring custom fields: its `id`,
 * `name`, `aria-label`, `placeholder`, or `<label>` text.
 */
export function elementIdentifierOf(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null
  const control = composedClosest(target, "input, select, textarea")
  if (
    !(
      control instanceof HTMLInputElement ||
      control instanceof HTMLSelectElement ||
      control instanceof HTMLTextAreaElement
    )
  )
    return null
  const candidates = [
    control.id,
    control.name,
    control.getAttribute("aria-label") ?? "",
    control instanceof HTMLSelectElement ? "" : control.placeholder,
    ...[...(control.labels ?? [])].map((label) => label.textContent ?? ""),
  ]
  for (const candidate of candidates) {
    const cleaned = candidate.replace(/\s+/g, " ").trim()
    if (cleaned) return cleaned
  }
  return null
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

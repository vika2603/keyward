/**
 * Telling a sign-up form from a sign-in form by what surrounds its fields: its buttons, the
 * requirements it states for a new password, and the page's title, headings and address. The
 * signals and their order of weight follow DuckDuckGo's autofill (its FormAnalyzer).
 */

import { composedParent, formOf } from "./deep-dom"

/** Labels that offer to sign up, or to sign in, matched with runs of white space collapsed. */
export const SIGN_UP_LABEL =
  /\b(sign ?up|register|registration|create( an| my| your)? (account|apple id)|join)\b|注册|註冊|创建账号|创建帐号|建立帳號/i
export const SIGN_IN_LABEL =
  /\b(log ?in|sign ?in|log ?on|sign ?on)\b|登录|登入|登陆|登錄/i
/** Elements that act as buttons; links are left out, as a sign-in form often links to signing up. */
export const BUTTONS =
  'button, input[type="submit"], input[type="button"], [role="button"]'
/**
 * How many levels with more than one child a search climbs from a field outside a form to its
 * buttons; wrappers around a single element do not count.
 */
const MAX_BRANCHING_LEVELS = 5
/** Controls that submit a form; a button without a type does. */
const SUBMIT_CONTROLS =
  'button[type="submit"], button:not([type]), input[type="submit"]'
/** Points a submitting button that signs up, or in, gives its form; it says most about the form. */
const SUBMIT_POINTS = 3
/**
 * Points another button gives, reversed while the group has a submitting button: a sign-in form
 * often has a button that leads to signing up, and a sign-up form one that leads to signing in.
 */
const OTHER_BUTTON_POINTS = 1
/** Points the requirements for a new password give, such as "at least 8 characters". */
const REQUIREMENT_POINTS = 2
/** Points a page's title, a main heading or the page's address gives. */
const PAGE_POINTS = 1
/** Headings beyond this length are prose rather than the page's name. */
const MAX_HEADING_LENGTH = 80
/** The form text read for password requirements; longer text holds more than the form. */
const MAX_FORM_TEXT = 2000
const PASSWORD_REQUIREMENTS =
  /at least (\d+|one) (characters?|letters?|numbers?|digits?|special|symbols?|uppercase|lowercase)|between \d+ and \d+ characters|\d+ or more characters|至少\s*\d+\s*位|\d+\s*[-~到至]\s*\d+\s*位/i

function collapsed(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim()
}

/**
 * An element's text with runs of white space collapsed, read only until it is longer than `limit`,
 * so a form that wraps a whole page does not have the page's text read on every scan.
 */
export function textUpTo(element: Element, limit: number): string {
  const walker = element.ownerDocument.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
  )
  let text = ""
  for (
    let node = walker.nextNode();
    node && text.length <= limit;
    node = walker.nextNode()
  ) {
    const piece = (node.nodeValue ?? "").replace(/\s+/g, " ")
    text += text === "" || text.endsWith(" ") ? piece.trimStart() : piece
  }
  return text.trimEnd()
}

function labelOf(control: HTMLElement): string {
  return collapsed(
    control instanceof HTMLInputElement ? control.value : control.textContent,
  )
}

/** The labels of the controls in `container` that match `selector`. */
export function controlLabels(container: Element, selector: string): string[] {
  return [...container.querySelectorAll<HTMLElement>(selector)].map(labelOf)
}

/**
 * The element whose buttons go with a field: its form, or for a field outside a form the nearest
 * ancestor with a button, as pages built without forms group a field with its buttons. Null when
 * no such ancestor is close.
 */
export function buttonGroupOf(field: HTMLInputElement): Element | null {
  const form = formOf(field)
  if (form) return form
  let levels = 0
  for (
    let node = composedParent(field);
    node && node !== field.ownerDocument.body;
    node = composedParent(node)
  ) {
    if (node.querySelector(BUTTONS)) return node
    if (node.childElementCount > 1 && ++levels >= MAX_BRANCHING_LEVELS) break
  }
  return null
}

/** `points` for a text that offers to sign up, minus `points` for one that offers to sign in. */
function signUpPoints(text: string, points: number): number {
  return (
    (SIGN_UP_LABEL.test(text) ? points : 0) -
    (SIGN_IN_LABEL.test(text) ? points : 0)
  )
}

/**
 * Points for a sign-up from the buttons of a field's group, below zero for a sign-in. Without a
 * submitting button, the others count as the submitting one would.
 */
export function buttonPoints(group: Element): number {
  const buttons = [...group.querySelectorAll<HTMLElement>(BUTTONS)]
  const submits = buttons.filter((button) => button.matches(SUBMIT_CONTROLS))
  const others = buttons.filter((button) => !button.matches(SUBMIT_CONTROLS))
  const pointsOf = (list: HTMLElement[], points: number) =>
    list.reduce((sum, button) => sum + signUpPoints(labelOf(button), points), 0)
  if (!submits.length) return pointsOf(others, SUBMIT_POINTS)
  return (
    pointsOf(submits, SUBMIT_POINTS) - pointsOf(others, OTHER_BUTTON_POINTS)
  )
}

/** Points for a sign-up when a group states requirements for a new password. */
export function requirementPoints(group: Element): number {
  const text = textUpTo(group, MAX_FORM_TEXT).slice(0, MAX_FORM_TEXT)
  return PASSWORD_REQUIREMENTS.test(text) ? REQUIREMENT_POINTS : 0
}

/**
 * Points for a sign-up from the page's title, its main headings and its address, below zero for a
 * sign-in. The address's dashes, underscores and slashes part its words, as in /users/sign_in.
 */
export function pagePoints(document: Document): number {
  const headings = [...document.querySelectorAll("h1, h2")]
    .map((heading) => collapsed(heading.textContent))
    .filter((text) => text && text.length <= MAX_HEADING_LENGTH)
  const path = (document.location?.pathname ?? "").replace(/[-_/.]+/g, " ")
  return [document.title, ...headings, path].reduce(
    (sum, text) => sum + signUpPoints(text, PAGE_POINTS),
    0,
  )
}

/**
 * Walking the page across shadow roots, as web components put fields there. A login form is the
 * nearest non-wrapper `<form>` across shadow boundaries.
 */

/** The elements that may hold a shadow root, by the DOM standard, besides custom elements. */
const SHADOW_HOST_NAMES = new Set([
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "BODY",
  "DIV",
  "FOOTER",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "MAIN",
  "NAV",
  "P",
  "SECTION",
  "SPAN",
])

/** Minimum descendants a direct child `<form>` of `body` must hold to count as a page wrapper. */
const PAGE_WRAPPER_MIN_ELEMENTS = 100
/** Share of `body` descendants a wrapper `<form>` holds before it is ignored as a form boundary. */
const PAGE_WRAPPER_BODY_RATIO = 0.5
/** Max branching levels climbed to infer a local form container inside a page-wrapper `<form>`. */
const LOCAL_CONTAINER_MAX_LEVELS = 5
const SUBMIT_SELECTOR =
  'button[type="submit"], button:not([type]), input[type="submit"], [role="button"]'

/** Deadline for an undefined custom element to upgrade before we stop re-checking it. */
const AWAITING_DEFINITION_TTL_MS = 60_000
/** Deadline for a defined custom element to attach its shadow root during lazy hydration. */
const AWAITING_SHADOW_TTL_MS = 30_000
/** Upper bound on tracked pending custom elements to keep scans bounded on heavy SPA pages. */
const MAX_PENDING_CUSTOM_HOSTS = 200

/** Hosts of Keyward's own shadow roots, such as the field icons', which no page walk enters. */
const ownHosts = new WeakSet<Element>()

/**
 * The closed root of each element asked, or null once it is settled. Asking the browser costs
 * about ten times the walk itself on a large page, so non-custom elements are asked once while
 * custom elements stay pending until they hydrate or expire.
 */
const closedRoots = new WeakMap<Element, ShadowRoot | null>()

interface PendingCustomHost {
  firstSeenAt: number
  definedAt: number | null
}

/** Custom elements that may still attach a shadow root asynchronously after first render. */
const pendingCustomHosts = new Map<Element, PendingCustomHost>()

export function markOwnHost(host: Element): void {
  ownHosts.add(host)
}

function trackPendingCustomHost(element: Element, defined: boolean): boolean {
  const now = Date.now()
  let entry = pendingCustomHosts.get(element)
  if (!entry) {
    if (pendingCustomHosts.size >= MAX_PENDING_CUSTOM_HOSTS) {
      const oldest = pendingCustomHosts.keys().next().value
      if (oldest) pendingCustomHosts.delete(oldest)
    }
    entry = { firstSeenAt: now, definedAt: defined ? now : null }
    pendingCustomHosts.set(element, entry)
    return true
  }
  if (defined && entry.definedAt === null) entry.definedAt = now
  const expired =
    entry.definedAt !== null
      ? now - entry.definedAt >= AWAITING_SHADOW_TTL_MS
      : now - entry.firstSeenAt >= AWAITING_DEFINITION_TTL_MS
  if (expired) {
    pendingCustomHosts.delete(element)
    return false
  }
  return true
}

/** Whether any connected custom elements are still awaiting definition or shadow-root hydration. */
export function hasPendingShadowHosts(): boolean {
  const now = Date.now()
  for (const [element, entry] of pendingCustomHosts) {
    if (!element.isConnected) {
      pendingCustomHosts.delete(element)
      continue
    }
    const expired =
      entry.definedAt !== null
        ? now - entry.definedAt >= AWAITING_SHADOW_TTL_MS
        : now - entry.firstSeenAt >= AWAITING_DEFINITION_TTL_MS
    if (expired) {
      pendingCustomHosts.delete(element)
      closedRoots.set(element, null)
    }
  }
  return pendingCustomHosts.size > 0
}

/**
 * An element's shadow root, a closed one included: a page closes a root to keep other scripts
 * out, and the browser still gives it to the extension.
 */
export function shadowRootOf(element: Element): ShadowRoot | null {
  if (ownHosts.has(element)) return null
  if (element.shadowRoot) {
    pendingCustomHosts.delete(element)
    return element.shadowRoot
  }
  const known = closedRoots.get(element)
  if (known !== undefined) return known
  const custom = element.localName.includes("-")
  if (!custom && !SHADOW_HOST_NAMES.has(element.nodeName)) return null
  if (!(element instanceof HTMLElement)) return null
  if (!browser.runtime?.id) return null
  let root: ShadowRoot | null = null
  try {
    root =
      (browser.dom?.openOrClosedShadowRoot?.(element) as ShadowRoot | null) ??
      null
  } catch {
    // The extension context can invalidate mid-scan when the extension reloads.
    return null
  }
  if (root) {
    pendingCustomHosts.delete(element)
    closedRoots.set(element, root)
    return root
  }
  if (!custom) {
    closedRoots.set(element, null)
    return null
  }
  const defined = element.matches(":defined")
  if (!trackPendingCustomHost(element, defined)) closedRoots.set(element, null)
  return null
}

/** The element an event started at, inside any shadow root, rather than the retargeted host. */
export function eventOrigin(event: Event): EventTarget | null {
  return event.composedPath()[0] ?? event.target
}

/** The focused element, looking into shadow roots. */
export function deepActiveElement(): Element | null {
  let active = document.activeElement
  while (active) {
    const inner = shadowRootOf(active)?.activeElement
    if (!inner) break
    active = inner
  }
  return active
}

/** The nearest ancestor matching a selector, continuing past shadow roots to their hosts. */
export function composedClosest(
  element: Element,
  selector: string,
): Element | null {
  let current: Element | null = element
  while (current) {
    const found = current.closest(selector)
    if (found) return found
    const root = current.getRootNode()
    current = root instanceof ShadowRoot ? root.host : null
  }
  return null
}

export function composedParent(element: Element): Element | null {
  if (element.parentElement) return element.parentElement
  const root = element.getRootNode()
  return root instanceof ShadowRoot ? root.host : null
}

/**
 * Whether `form` safely exposes an iterable `elements` collection. Some legacy sites define
 * `<input name="elements">`, which shadows `HTMLFormElement.prototype.elements`.
 */
export function hasIterableFormElements(form: HTMLFormElement): boolean {
  return Symbol.iterator in Object(form.elements)
}

/**
 * Whether `form` wraps the whole page (as in ASP.NET WebForms), in which case treating it as a
 * single form mixes unrelated header search bars and login boxes together. Requires page-level
 * landmarks (header/nav/footer) so a long standalone sign-up form with many `<option>` tags is
 * never misclassified as a page wrapper.
 */
export function isPageWrapperForm(form: HTMLFormElement): boolean {
  const body = form.ownerDocument.body
  if (!body || form.parentElement !== body) return false
  if (!form.querySelector("header, nav, footer")) return false
  let formElements = 0
  for (const element of form.getElementsByTagName("*")) {
    if (element.nodeName !== "OPTION" && element.nodeName !== "OPTGROUP")
      formElements++
  }
  if (formElements < PAGE_WRAPPER_MIN_ELEMENTS) return false
  let bodyElements = 0
  for (const element of body.getElementsByTagName("*")) {
    if (element.nodeName !== "OPTION" && element.nodeName !== "OPTGROUP")
      bodyElements++
  }
  return formElements > bodyElements * PAGE_WRAPPER_BODY_RATIO
}

function nearestFormElement(element: Element): HTMLFormElement | null {
  if (element instanceof HTMLInputElement && element.form) return element.form
  const form = composedClosest(element, "form")
  return form instanceof HTMLFormElement ? form : null
}

export function formOf(element: Element): HTMLFormElement | null {
  const form = nearestFormElement(element)
  if (!form || isPageWrapperForm(form)) return null
  return form
}

/**
 * The nearest open native `<dialog>` ancestor holding `element`, or null when none.
 * Native modal `<dialog>` elements mark everything outside their subtree `inert`.
 */
export function openDialogOf(element: Element): HTMLDialogElement | null {
  const documentElement = element.ownerDocument.documentElement
  for (
    let ancestor = composedParent(element);
    ancestor && ancestor !== documentElement;
    ancestor = composedParent(ancestor)
  ) {
    if (ancestor instanceof HTMLDialogElement && ancestor.open) return ancestor
  }
  return null
}

/**
 * The nearest enclosing modal container (`<dialog open>` or ARIA `aria-modal="true"` dialog)
 * holding `element`, or null when `element` is not inside a modal. Mounting overlays inside the
 * modal subtree keeps them interactive under `<dialog>.showModal()` inertness and modal focus traps.
 */
export function modalContainerOf(element: Element): HTMLElement | null {
  const documentElement = element.ownerDocument.documentElement
  for (
    let ancestor = composedParent(element);
    ancestor && ancestor !== documentElement;
    ancestor = composedParent(ancestor)
  ) {
    if (ancestor instanceof HTMLDialogElement && ancestor.open) return ancestor
    if (ancestor instanceof HTMLElement) {
      const role = ancestor.getAttribute("role")
      if (
        (role === "dialog" || role === "alertdialog") &&
        ancestor.getAttribute("aria-modal") === "true"
      )
        return ancestor
    }
  }
  return null
}

function hasInteractiveFormChild(
  node: Element,
  ignoredForm: HTMLFormElement | null,
): boolean {
  for (const nestedForm of node.querySelectorAll("form")) {
    if (nestedForm === ignoredForm || isPageWrapperForm(nestedForm)) continue
    if (
      nestedForm.querySelector(
        'input:not([type="hidden"]), button, select, textarea',
      )
    )
      return true
  }
  return false
}

/**
 * Walks up from a field inside a page-wrapper `<form>` to find the tightest local container
 * holding sibling inputs or a submit control, stopping before the wrapper form itself.
 */
function localContainerInsideWrapper(
  element: Element,
  wrapperForm: HTMLFormElement,
): Element | null {
  let levels = 0
  let fallback: Element | null = null
  for (
    let node = composedParent(element);
    node && node !== wrapperForm && node !== element.ownerDocument.body;
    node = composedParent(node)
  ) {
    if (hasInteractiveFormChild(node, wrapperForm)) return fallback
    const visibleInputs = node.querySelectorAll(
      'input:not([type="hidden"])',
    ).length
    if (visibleInputs > 1 || node.querySelector(SUBMIT_SELECTOR)) return node
    if (visibleInputs >= 1) fallback = node
    if (node.childElementCount > 1 && ++levels >= LOCAL_CONTAINER_MAX_LEVELS)
      break
  }
  return fallback
}

/**
 * Where a field's form fields are: an explicit boundary when given, its non-wrapper form, a tight
 * local container when inside a page-wrapper `<form>`, or the whole document when it has none.
 */
export function scopeOf(
  element: Element,
  forcedBoundary?: Element | null,
): ParentNode {
  if (forcedBoundary) return forcedBoundary
  const nearest = nearestFormElement(element)
  if (nearest) {
    if (!isPageWrapperForm(nearest)) return nearest
    return (
      localContainerInsideWrapper(element, nearest) ?? element.ownerDocument
    )
  }
  return element.ownerDocument
}

export type FormControlElement =
  | HTMLInputElement
  | HTMLSelectElement
  | HTMLTextAreaElement

function isFormControl(node: Node): node is FormControlElement {
  return (
    node instanceof HTMLInputElement ||
    node instanceof HTMLSelectElement ||
    node instanceof HTMLTextAreaElement
  )
}

/**
 * All inputs in a scope in tree order, including those in shadow roots inside it. When
 * `onShadowRoot` is given, every shadow root entered is reported so observers can watch it too.
 */
export function deepInputs(
  scope: ParentNode,
  onShadowRoot?: (root: ShadowRoot) => void,
): HTMLInputElement[] {
  const found: HTMLInputElement[] = []
  const visit = (root: Node) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node instanceof HTMLInputElement) found.push(node)
      const shadow = shadowRootOf(node as Element)
      if (shadow) {
        onShadowRoot?.(shadow)
        visit(shadow)
      }
    }
  }
  visit(scope as unknown as Node)
  return found
}

/** All inputs, selects and textareas in a scope in tree order, across shadow roots. */
export function deepFormControls(scope: ParentNode): FormControlElement[] {
  const found: FormControlElement[] = []
  const visit = (root: Node) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (isFormControl(node)) found.push(node)
      const shadow = shadowRootOf(node as Element)
      if (shadow) visit(shadow)
    }
  }
  visit(scope as unknown as Node)
  return found
}

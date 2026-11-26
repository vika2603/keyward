/**
 * Walking the page across shadow roots, as web components put fields there. A login form is the
 * nearest `<form>` across shadow boundaries.
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

/** Hosts of Keyward's own shadow roots, such as the field icons', which no page walk enters. */
const ownHosts = new WeakSet<Element>()

/**
 * The closed root of each element asked, or null for one that had none once it was defined. Asking
 * the browser costs about ten times the walk itself on a large page, so each element is asked
 * once; a closed root a page attaches to one of them later is missed. A root, once attached, stays.
 */
const closedRoots = new WeakMap<Element, ShadowRoot | null>()

export function markOwnHost(host: Element): void {
  ownHosts.add(host)
}

/**
 * An element's shadow root, a closed one included: a page closes a root to keep other scripts
 * out, and the browser still gives it to the extension.
 */
export function shadowRootOf(element: Element): ShadowRoot | null {
  if (ownHosts.has(element)) return null
  if (element.shadowRoot) return element.shadowRoot
  const known = closedRoots.get(element)
  if (known !== undefined) return known
  const custom = element.localName.includes("-")
  if (!custom && !SHADOW_HOST_NAMES.has(element.nodeName)) return null
  if (!(element instanceof HTMLElement)) return null
  const root =
    (browser.dom?.openOrClosedShadowRoot?.(element) as ShadowRoot | null) ??
    null
  // A custom element gets its root once it is defined, which may come after this walk.
  if (root || !custom || element.matches(":defined"))
    closedRoots.set(element, root)
  return root
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
function composedClosest(element: Element, selector: string): Element | null {
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

export function formOf(element: Element): HTMLFormElement | null {
  if (element instanceof HTMLInputElement && element.form) return element.form
  const form = composedClosest(element, "form")
  return form instanceof HTMLFormElement ? form : null
}

/** Where a field's form fields are: its form, or the whole document when it has none. */
export function scopeOf(element: Element): ParentNode {
  return formOf(element) ?? element.ownerDocument
}

/** All inputs in a scope in tree order, including those in shadow roots inside it. */
export function deepInputs(scope: ParentNode): HTMLInputElement[] {
  const found: HTMLInputElement[] = []
  const visit = (root: Node) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node instanceof HTMLInputElement) found.push(node)
      const shadow = shadowRootOf(node as Element)
      if (shadow) visit(shadow)
    }
  }
  visit(scope as unknown as Node)
  return found
}

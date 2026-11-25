/**
 * Walking the page across open shadow roots, as web components put fields there. A login form is
 * the nearest `<form>` across shadow boundaries.
 */

/** The element an event started at, inside any shadow root, rather than the retargeted host. */
export function eventOrigin(event: Event): EventTarget | null {
  return event.composedPath()[0] ?? event.target
}

/** The focused element, looking into open shadow roots. */
export function deepActiveElement(): Element | null {
  let active = document.activeElement
  while (active?.shadowRoot?.activeElement)
    active = active.shadowRoot.activeElement
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

/** All inputs in a scope in tree order, including those in open shadow roots inside it. */
export function deepInputs(scope: ParentNode): HTMLInputElement[] {
  const found: HTMLInputElement[] = []
  const visit = (root: Node) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node instanceof HTMLInputElement) found.push(node)
      const shadow = (node as Element).shadowRoot
      if (shadow) visit(shadow)
    }
  }
  visit(scope as unknown as Node)
  return found
}

import type { ContentScriptContext } from "wxt/utils/content-script-context"

interface Listener {
  type: string
  listener: (event: Event) => void
  options?: AddEventListenerOptions
}

/**
 * Listens for the page's events on the document and inside the shadow roots that hold fields.
 * Focus moving between two fields of one shadow root reaches the document not at all, and an event
 * from inside a closed root reaches it as coming from the root's host. Such a root gets the
 * listeners itself, and the listeners above it leave its events to them.
 */
export class PageEvents {
  private readonly listeners: Listener[] = []
  private readonly roots = new Set<ShadowRoot>()
  /** The hosts of `roots`, which an event's path passes on its way out of them. */
  private readonly hosts = new WeakSet<Element>()

  constructor(private readonly ctx: ContentScriptContext) {}

  on<K extends keyof DocumentEventMap>(
    type: K,
    listener: (event: DocumentEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void {
    const entry = {
      type,
      listener: listener as (event: Event) => void,
      options,
    }
    this.listeners.push(entry)
    this.attach(document, entry)
    for (const root of this.roots) this.attach(root, entry)
  }

  /** Listens inside the shadow roots the field is in, if any. */
  watchRootsOf(field: Element): void {
    for (
      let root = field.getRootNode();
      root instanceof ShadowRoot;
      root = root.host.getRootNode()
    ) {
      if (this.roots.has(root)) continue
      this.roots.add(root)
      this.hosts.add(root.host)
      for (const entry of this.listeners) this.attach(root, entry)
    }
  }

  private attach(
    target: Document | ShadowRoot,
    { type, listener, options }: Listener,
  ): void {
    this.ctx.addEventListener(
      target,
      type,
      (event: Event) => {
        if (!this.isFromRootWithin(event, target)) listener(event)
      },
      options,
    )
  }

  /** Whether the event comes from a root listened to inside `target`, whose listeners take it. */
  private isFromRootWithin(event: Event, target: EventTarget): boolean {
    for (const node of event.composedPath()) {
      if (node === target) return false
      if (node instanceof Element && this.hosts.has(node)) return true
    }
    return false
  }
}

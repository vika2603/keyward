import type { ContentScriptContext } from "wxt/utils/content-script-context"
import { createIframeUi } from "wxt/utils/content-script-ui/iframe"
import { eventOrigin } from "./fields"

/** Room around the overlay's card for its shadow, inside the iframe. */
const SHADOW_MARGIN = 8
const PROMPT_WIDTH = 340
/** The menu is as wide as its field, within limits that keep its rows readable. */
const MENU_MIN_WIDTH = 280
const MENU_MAX_WIDTH = 480
const GAP = 6
const MAX_HEIGHT = 600

type IframeUi = ReturnType<typeof createIframeUi<void>>

/**
 * Sets inline styles with priority over every page stylesheet: `all: initial` first, so that no
 * page rule (transforms, clipping, blending and the like) reaches the element, then the given values.
 */
function lockStyle(element: HTMLElement, styles: Record<string, string>): void {
  element.removeAttribute("style")
  element.style.setProperty("all", "initial", "important")
  for (const [name, value] of Object.entries(styles))
    element.style.setProperty(name, value, "important")
}

/**
 * One extension page shown in an iframe over the web page. The page reports its height through the
 * background; until then the frame stays hidden. The frame and its wrapper sit in the page's DOM,
 * so a change the page makes to them closes the overlay, and any move is reported to the frame,
 * which then waits before it accepts a click (see `useTrackVisible`).
 */
class Overlay {
  private ui: IframeUi | null = null
  private height = 0
  private readonly origin: string
  /** The frame's width, card and shadow room together. */
  private width = PROMPT_WIDTH + SHADOW_MARGIN * 2
  private observer: MutationObserver | null = null
  private watchFrame = 0
  private lastRect = ""
  private expected = ""
  /** Every wrapper this overlay put in the page, including removed ones whose removal is still reported. */
  private readonly wrappers = new WeakSet<Node>()

  constructor(
    private readonly ctx: ContentScriptContext,
    private readonly page: "/inline-menu.html" | "/save-prompt.html",
    private readonly onTampered: () => void,
    /** The color scheme the extension page will use, which the iframe element must declare too. */
    private readonly scheme: () => "light" | "dark",
  ) {
    this.origin = new URL(browser.runtime.getURL(page)).origin
  }

  get iframe(): HTMLIFrameElement | null {
    return this.ui?.iframe ?? null
  }

  /** Shows the page; `token` is posted only to this frame, whose requests must carry it. */
  show(token: string): void {
    this.hide()
    this.height = 0
    const ui = createIframeUi(this.ctx, {
      page: this.page,
      position: "inline",
      anchor: () => document.documentElement,
      onMount: (wrapper, iframe) => {
        lockStyle(wrapper, {
          position: "fixed",
          "z-index": "2147483647",
          display: "block",
          width: `${this.width}px`,
          height: "0",
          visibility: "hidden",
        })
        lockStyle(iframe, {
          display: "block",
          width: "100%",
          height: "100%",
          // Chrome paints an opaque backdrop behind a frame whose color scheme differs from its
          // element's, and the frame's prefers-color-scheme follows this value.
          "color-scheme": this.scheme(),
        })
        iframe.setAttribute("allowtransparency", "true")
        // A target origin keeps the token from a document the page may have navigated the frame to.
        iframe.addEventListener("load", () =>
          iframe.contentWindow?.postMessage(
            { keywardOverlay: token },
            this.origin,
          ),
        )
      },
    })
    this.wrappers.add(ui.wrapper)
    ui.mount()
    this.ui = ui
    this.guard(ui)
  }

  /** Whether a node is the overlay's wrapper or inside it. */
  owns(node: Node): boolean {
    for (let current: Node | null = node; current; current = current.parentNode)
      if (this.wrappers.has(current)) return true
    return false
  }

  hide(): void {
    this.observer?.disconnect()
    this.observer = null
    cancelAnimationFrame(this.watchFrame)
    this.watchFrame = 0
    this.ui?.remove()
    this.ui = null
  }

  resize(height: number): void {
    this.height = Math.max(0, Math.min(height, MAX_HEIGHT))
    this.setWrapper({
      height: `${this.height + SHADOW_MARGIN * 2}px`,
      visibility: this.height ? "visible" : "hidden",
    })
  }

  /**
   * Places the frame below the field, or above it when there is no room below, as wide as the field
   * within the menu's limits.
   */
  placeBelow(field: HTMLElement): void {
    const rect = field.getBoundingClientRect()
    this.width =
      Math.round(
        Math.min(Math.max(rect.width, MENU_MIN_WIDTH), MENU_MAX_WIDTH),
      ) +
      SHADOW_MARGIN * 2
    const total = this.height + SHADOW_MARGIN * 2
    const below = rect.bottom + GAP - SHADOW_MARGIN
    const above = rect.top - GAP - this.height - SHADOW_MARGIN
    const top = below + total <= innerHeight || above < 0 ? below : above
    const left = Math.min(
      Math.max(rect.left - SHADOW_MARGIN, 0),
      Math.max(innerWidth - this.width, 0),
    )
    this.setWrapper({
      top: `${Math.round(top)}px`,
      left: `${Math.round(left)}px`,
      width: `${this.width}px`,
    })
  }

  placeTopRight(): void {
    this.setWrapper({
      top: `${12 - SHADOW_MARGIN}px`,
      right: `${12 - SHADOW_MARGIN}px`,
    })
  }

  private setWrapper(styles: Record<string, string>): void {
    if (!this.ui) return
    for (const [name, value] of Object.entries(styles)) {
      this.ui.wrapper.style.setProperty(name, value, "important")
    }
    this.expected = this.snapshot()
  }

  private snapshot(): string {
    const ui = this.ui
    if (!ui) return ""
    return [
      ui.wrapper.getAttribute("style"),
      ui.wrapper.getAttribute("class"),
      ui.iframe.getAttribute("style"),
      ui.iframe.getAttribute("src"),
      ui.wrapper.parentNode === document.documentElement,
      ui.iframe.parentNode === ui.wrapper,
    ].join("\n")
  }

  /** Closes the overlay when the page edits or moves its elements; reports moves to the frame. */
  private guard(ui: IframeUi): void {
    this.expected = this.snapshot()
    this.lastRect = ""
    // Until it loads, the frame holds an empty document of the page's origin, which must not get messages.
    let loaded = false
    ui.iframe.addEventListener("load", () => {
      loaded = true
    })
    this.observer = new MutationObserver(() => {
      if (this.ui === ui && this.snapshot() !== this.expected) this.onTampered()
    })
    this.observer.observe(ui.wrapper, {
      attributes: true,
      subtree: true,
      childList: true,
    })
    this.observer.observe(document.documentElement, { childList: true })
    const watch = () => {
      if (this.ui !== ui) return
      const r = ui.iframe.getBoundingClientRect()
      const rect = `${r.x},${r.y},${r.width},${r.height}`
      if (loaded && rect !== this.lastRect) {
        this.lastRect = rect
        ui.iframe.contentWindow?.postMessage(
          { keywardOverlayMoved: 1 },
          this.origin,
        )
      }
      this.watchFrame = requestAnimationFrame(watch)
    }
    this.watchFrame = requestAnimationFrame(watch)
  }
}

/** The login menu under a field. It closes on Escape and on a press outside it. */
export class InlineMenu {
  private readonly overlay: Overlay
  private field: HTMLInputElement | null = null
  private frame = 0

  constructor(
    ctx: ContentScriptContext,
    scheme: () => "light" | "dark",
    private readonly onClosed: () => void,
    /** Elements of the extension in the page, such as the field icons, that do not close the menu. */
    isOwnElement: (target: EventTarget | null) => boolean,
  ) {
    this.overlay = new Overlay(
      ctx,
      "/inline-menu.html",
      () => this.close(),
      scheme,
    )
    const reposition = () => {
      if (!this.field || this.frame) return
      this.frame = requestAnimationFrame(() => {
        this.frame = 0
        if (this.field) this.overlay.placeBelow(this.field)
      })
    }
    ctx.addEventListener(window, "scroll", reposition, {
      capture: true,
      passive: true,
    })
    ctx.addEventListener(window, "resize", reposition, { passive: true })
    ctx.addEventListener(
      document,
      "pointerdown",
      (event) => {
        if (
          this.field &&
          eventOrigin(event) !== this.field &&
          !isOwnElement(event.target)
        )
          this.close()
      },
      { capture: true },
    )
    ctx.addEventListener(
      document,
      "keydown",
      (event) => {
        if (!this.field) return
        if (event.key === "Escape") this.close()
        else if (
          event.key === "ArrowDown" &&
          event.isTrusted &&
          eventOrigin(event) === this.field
        ) {
          event.preventDefault()
          this.overlay.iframe?.focus()
        }
      },
      { capture: true },
    )
  }

  get openFor(): HTMLInputElement | null {
    return this.field
  }

  owns(node: Node): boolean {
    return this.overlay.owns(node)
  }

  show(field: HTMLInputElement, token: string): void {
    this.field = field
    this.overlay.show(token)
    this.overlay.placeBelow(field)
  }

  resize(height: number): void {
    this.overlay.resize(height)
    if (this.field) this.overlay.placeBelow(this.field)
  }

  close(): void {
    if (!this.field) return
    this.field = null
    this.overlay.hide()
    this.onClosed()
  }
}

/** The prompt to save or update a login, at the top right of the top frame. */
export class SavePrompt {
  private readonly overlay: Overlay

  constructor(ctx: ContentScriptContext, scheme: () => "light" | "dark") {
    this.overlay = new Overlay(
      ctx,
      "/save-prompt.html",
      () => this.close(),
      scheme,
    )
  }

  show(token: string): void {
    this.overlay.show(token)
    this.overlay.placeTopRight()
  }

  owns(node: Node): boolean {
    return this.overlay.owns(node)
  }

  resize(height: number): void {
    this.overlay.resize(height)
  }

  close(): void {
    this.overlay.hide()
  }
}

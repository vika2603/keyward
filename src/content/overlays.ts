import type { ContentScriptContext } from "wxt/utils/content-script-context"
import { createIframeUi } from "wxt/utils/content-script-ui/iframe"
import { deepActiveElement, eventOrigin, modalContainerOf } from "./deep-dom"
import { isContextAlive } from "./extension-messages"
import {
  restoreFieldAutocomplete,
  suppressFieldAutocomplete,
} from "./field-hints"
import { PROMPT_WIDTH } from "./overlay-size"
import type { PageEvents } from "./page-events"

/** Room around the overlay's card for its shadow, inside the iframe. */
const SHADOW_MARGIN = 8
/** The highest z-index there is, so that no page element covers an overlay. */
const OVERLAY_Z_INDEX = "2147483647"
/** The save prompt's distance from the top right corner of the window. */
const PROMPT_INSET = 12
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

function supportsPopover(element: HTMLElement): boolean {
  return typeof element.showPopover === "function"
}

function promotePopover(element: HTMLElement): void {
  if (!supportsPopover(element)) return
  try {
    if (!element.matches(":popover-open")) element.showPopover()
  } catch {
    // Ignore when disconnected or popover promotion is unavailable.
  }
}

/**
 * One extension page shown in an iframe over the web page. The page reports its height through the
 * background; until then the frame stays hidden. The frame and its wrapper sit in the page's DOM,
 * so a change the page makes to them closes the overlay, and any move is reported to the frame,
 * which then waits before it accepts a click (see `useClickGuard`).
 */
class Overlay {
  private ui: IframeUi | null = null
  private anchor: HTMLElement = document.documentElement
  private height = 0
  private readonly origin: string
  /** The frame's width, card and shadow room together. */
  private width = PROMPT_WIDTH + SHADOW_MARGIN * 2
  private observer: MutationObserver | null = null
  private watchFrame = 0
  private lastRect = ""
  private expected = ""
  private token = ""
  private loaded = false
  private pendingFocus = false
  /** Every wrapper this overlay put in the page, including removed ones whose removal is still reported. */
  private readonly wrappers = new WeakSet<Node>()

  constructor(
    private readonly ctx: ContentScriptContext,
    private readonly page: "/inline-menu.html" | "/save-prompt.html",
    private readonly onTampered: () => void,
    /** The color scheme the extension page will use, which the iframe element must declare too. */
    private readonly scheme: () => "light" | "dark",
    /** Optional per-frame hook while the overlay is open, such as keeping position synced with its field. */
    private readonly onFrame?: () => void,
  ) {
    this.origin = new URL(browser.runtime.getURL(page)).origin
    ctx.onInvalidated(() => this.hide())
  }

  get iframe(): HTMLIFrameElement | null {
    return this.ui?.iframe ?? null
  }

  /** Shows the page; `token` is posted only to this frame, whose requests must carry it. */
  show(token: string, anchor: HTMLElement = document.documentElement): void {
    this.hide()
    if (!isContextAlive(this.ctx)) return
    this.anchor = anchor.isConnected ? anchor : document.documentElement
    this.height = 0
    this.token = token
    this.loaded = false
    this.pendingFocus = false
    const ui = createIframeUi(this.ctx, {
      page: this.page,
      position: "inline",
      anchor: () => this.anchor,
      onMount: (wrapper, iframe) => {
        if (supportsPopover(wrapper)) wrapper.setAttribute("popover", "manual")
        lockStyle(wrapper, {
          position: "fixed",
          "z-index": OVERLAY_Z_INDEX,
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
        iframe.addEventListener("load", () => {
          if (this.ui?.iframe !== iframe) return
          this.loaded = true
          iframe.contentWindow?.postMessage(
            { keywardOverlay: token },
            this.origin,
          )
          if (this.pendingFocus) {
            this.pendingFocus = false
            iframe.contentWindow?.postMessage(
              { keywardOverlayFocus: token },
              this.origin,
            )
          }
        })
      },
    })
    this.wrappers.add(ui.wrapper)
    ui.mount()
    promotePopover(ui.wrapper)
    this.ui = ui
    this.guard(ui)
  }

  /** Moves the focus into the frame and tells it, with the session token, to select its first item. */
  focusFirst(): void {
    const iframe = this.ui?.iframe
    if (!iframe) return
    iframe.focus()
    if (this.loaded) {
      iframe.contentWindow?.postMessage(
        { keywardOverlayFocus: this.token },
        this.origin,
      )
    } else {
      this.pendingFocus = true
    }
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
    this.loaded = false
    this.pendingFocus = false
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
      top: `${PROMPT_INSET - SHADOW_MARGIN}px`,
      right: `${PROMPT_INSET - SHADOW_MARGIN}px`,
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
      ui.wrapper.getAttribute("popover"),
      ui.iframe.getAttribute("style"),
      ui.iframe.getAttribute("src"),
      ui.wrapper.parentNode === this.anchor,
      ui.wrapper.isConnected,
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
    this.observer.observe(this.anchor, { childList: true })
    const watch = () => {
      if (this.ui !== ui) return
      if (!ui.wrapper.isConnected) {
        this.onTampered()
        return
      }
      this.onFrame?.()
      if (this.ui !== ui) return
      const box = ui.iframe.getBoundingClientRect()
      // Height changes come only from the overlay's own resize; rounded position and width catch
      // real moves and zoom without resetting the click guard on sub-pixel layout jitter.
      const rect = `${Math.round(box.x)},${Math.round(box.y)},${Math.round(box.width)}`
      if (loaded) {
        if (this.lastRect !== "" && rect !== this.lastRect) {
          ui.iframe.contentWindow?.postMessage(
            { keywardOverlayMoved: 1 },
            this.origin,
          )
        }
        this.lastRect = rect
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
  private suppressedField: HTMLInputElement | null = null
  private lastFieldRect = ""
  private frame = 0
  /** Set briefly when returning focus from the menu's cross-origin frame, which fires a trusted focusin. */
  private returningTo: HTMLInputElement | null = null
  private returnTimer = 0
  private focusOutTimer = 0

  constructor(
    ctx: ContentScriptContext,
    events: PageEvents,
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
      () => this.syncFieldPosition(),
    )
    const reposition = () => {
      if (!this.field || this.frame) return
      this.frame = requestAnimationFrame(() => {
        this.frame = 0
        if (this.field) this.placeForField(this.field)
      })
    }
    ctx.addEventListener(window, "scroll", reposition, {
      capture: true,
      passive: true,
    })
    ctx.addEventListener(window, "resize", reposition, { passive: true })
    events.on(
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
    // Losing the focus to anything but the menu or Keyward's own elements closes the menu too. A
    // click outside the frame the field is in, as around a sign-in form in an iframe, reaches no
    // pointerdown here, and neither does the Tab key.
    events.on(
      "focusout",
      (event) => {
        const field = this.field
        if (!field || eventOrigin(event) !== field) return
        // The focus has moved on by the next task.
        clearTimeout(this.focusOutTimer)
        this.focusOutTimer = window.setTimeout(() => {
          this.focusOutTimer = 0
          if (this.field !== field) return
          const active = deepActiveElement()
          const backInField = active === field && document.hasFocus()
          const inOwnElement =
            active !== null &&
            (this.overlay.owns(active) || isOwnElement(active))
          if (!backInField && !inOwnElement) this.close()
        })
      },
      { capture: true },
    )
    events.on(
      "keydown",
      (event) => {
        if (!this.field) return
        if (event.key === "Escape") {
          event.preventDefault()
          event.stopImmediatePropagation()
          this.close(true)
        } else if (
          event.key === "ArrowDown" &&
          event.isTrusted &&
          !event.isComposing &&
          eventOrigin(event) === this.field
        ) {
          event.preventDefault()
          this.overlay.focusFirst()
        }
      },
      { capture: true },
    )
    ctx.onInvalidated(() => {
      cancelAnimationFrame(this.frame)
      this.frame = 0
      clearTimeout(this.returnTimer)
      this.returnTimer = 0
      clearTimeout(this.focusOutTimer)
      this.focusOutTimer = 0
      this.returningTo = null
      this.field = null
      this.lastFieldRect = ""
      this.restoreAutocomplete()
      this.overlay.hide()
    })
  }

  get openFor(): HTMLInputElement | null {
    return this.field
  }

  owns(node: Node): boolean {
    return this.overlay.owns(node)
  }

  show(field: HTMLInputElement, token: string): void {
    this.restoreAutocomplete()
    this.field = field
    this.suppressAutocomplete(field)
    this.overlay.show(
      token,
      modalContainerOf(field) ?? document.documentElement,
    )
    this.placeForField(field)
  }

  private placeForField(field: HTMLInputElement): void {
    const rect = field.getBoundingClientRect()
    this.lastFieldRect = `${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.right)},${Math.round(rect.bottom)}`
    this.overlay.placeBelow(field)
  }

  private syncFieldPosition(): void {
    const field = this.field
    if (!field) return
    if (!field.isConnected) {
      this.close()
      return
    }
    const rect = field.getBoundingClientRect()
    const key = `${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.right)},${Math.round(rect.bottom)}`
    if (key !== this.lastFieldRect) {
      this.lastFieldRect = key
      this.overlay.placeBelow(field)
    }
  }

  private suppressAutocomplete(field: HTMLInputElement): void {
    this.suppressedField = field
    // Suppress the browser's own autocomplete dropdown while Keyward's menu is open.
    suppressFieldAutocomplete(field)
  }

  private restoreAutocomplete(): void {
    const field = this.suppressedField
    if (!field) return
    this.suppressedField = null
    restoreFieldAutocomplete(field)
  }

  resize(height: number): void {
    this.overlay.resize(height)
    if (this.field) this.overlay.placeBelow(this.field)
  }

  focusField(): void {
    if (this.field) this.returnFocusTo(this.field)
  }

  /** Whether a focusin on `target` came from the menu handing the focus back. */
  isReturningFocus(target: EventTarget | null): boolean {
    if (!this.returningTo || target !== this.returningTo) return false
    clearTimeout(this.returnTimer)
    this.returningTo = null
    return true
  }

  private returnFocusTo(field: HTMLInputElement): void {
    clearTimeout(this.returnTimer)
    this.returningTo = field
    this.returnTimer = window.setTimeout(() => {
      this.returningTo = null
    }, 200)
    field.focus({ preventScroll: true })
  }

  close(focusField = false): void {
    if (!this.field) return
    const field = this.field
    this.field = null
    this.restoreAutocomplete()
    this.overlay.hide()
    if (focusField) this.returnFocusTo(field)
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

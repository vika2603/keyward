import type { ContentScriptContext } from "wxt/utils/content-script-context"
import { createIframeUi } from "wxt/utils/content-script-ui/iframe"

/** Room around the overlay's card for its shadow, inside the iframe. */
export const SHADOW_MARGIN = 8
const WIDTH = 340 + SHADOW_MARGIN * 2
const GAP = 6

type IframeUi = ReturnType<typeof createIframeUi<void>>

/**
 * One extension page shown in an iframe over the web page. The page reports its height through the
 * background; until then the frame stays hidden.
 */
class Overlay {
  private ui: IframeUi | null = null
  private height = 0

  constructor(
    private readonly ctx: ContentScriptContext,
    private readonly page: "/inline-menu.html" | "/save-prompt.html",
  ) {}

  get open(): boolean {
    return this.ui !== null
  }

  get iframe(): HTMLIFrameElement | null {
    return this.ui?.iframe ?? null
  }

  /** Shows the page; `token` is posted only to this frame, whose requests must carry it. */
  show(token: string): void {
    this.hide()
    this.height = 0
    const origin = new URL(browser.runtime.getURL(this.page)).origin
    const ui = createIframeUi(this.ctx, {
      page: this.page,
      position: "inline",
      anchor: () => document.documentElement,
      onMount: (wrapper, iframe) => {
        for (const [name, value] of Object.entries({
          position: "fixed",
          "z-index": "2147483647",
          width: `${WIDTH}px`,
          height: "0",
          margin: "0",
          padding: "0",
          border: "0",
          display: "block",
          visibility: "hidden",
          // The menu refuses clicks while it is not plainly visible; page styles must not change that.
          opacity: "1",
          filter: "none",
          transform: "none",
        })) {
          wrapper.style.setProperty(name, value, "important")
        }
        for (const [name, value] of Object.entries({
          width: "100%",
          height: "100%",
          border: "0",
          margin: "0",
          padding: "0",
          display: "block",
          background: "transparent",
          opacity: "1",
          filter: "none",
          transform: "none",
          // Matches the extension page, which sets no color scheme, so the frame stays transparent.
          "color-scheme": "normal",
        })) {
          iframe.style.setProperty(name, value, "important")
        }
        iframe.setAttribute("allowtransparency", "true")
        // A target origin keeps the token from a document the page may have navigated the frame to.
        iframe.addEventListener("load", () =>
          iframe.contentWindow?.postMessage({ keywardOverlay: token }, origin),
        )
      },
    })
    ui.mount()
    this.ui = ui
  }

  hide(): void {
    this.ui?.remove()
    this.ui = null
  }

  resize(height: number): void {
    if (!this.ui) return
    this.height = Math.max(0, Math.min(height, 600))
    this.ui.wrapper.style.setProperty(
      "height",
      `${this.height + SHADOW_MARGIN * 2}px`,
      "important",
    )
    this.ui.wrapper.style.setProperty(
      "visibility",
      this.height ? "visible" : "hidden",
      "important",
    )
  }

  /** Places the frame below the field, or above it when there is no room below. */
  placeBelow(field: HTMLElement): void {
    if (!this.ui) return
    const rect = field.getBoundingClientRect()
    const total = this.height + SHADOW_MARGIN * 2
    const below = rect.bottom + GAP - SHADOW_MARGIN
    const above = rect.top - GAP - this.height - SHADOW_MARGIN
    const top = below + total <= innerHeight || above < 0 ? below : above
    const left = Math.min(
      Math.max(rect.left - SHADOW_MARGIN, 0),
      Math.max(innerWidth - WIDTH, 0),
    )
    this.ui.wrapper.style.setProperty(
      "top",
      `${Math.round(top)}px`,
      "important",
    )
    this.ui.wrapper.style.setProperty(
      "left",
      `${Math.round(left)}px`,
      "important",
    )
  }

  placeTopRight(): void {
    if (!this.ui) return
    this.ui.wrapper.style.setProperty(
      "top",
      `${12 - SHADOW_MARGIN}px`,
      "important",
    )
    this.ui.wrapper.style.setProperty(
      "right",
      `${12 - SHADOW_MARGIN}px`,
      "important",
    )
  }
}

/** The login menu under a field. It closes on Escape and on a press outside it. */
export class InlineMenu {
  private readonly overlay: Overlay
  private field: HTMLInputElement | null = null
  private frame = 0

  constructor(
    ctx: ContentScriptContext,
    private readonly onClosed: () => void,
    /** Elements of the extension in the page, such as the field icons, that do not close the menu. */
    isOwnElement: (target: EventTarget | null) => boolean,
  ) {
    this.overlay = new Overlay(ctx, "/inline-menu.html")
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
          event.target !== this.field &&
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
        else if (event.key === "ArrowDown" && event.target === this.field) {
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

  constructor(ctx: ContentScriptContext) {
    this.overlay = new Overlay(ctx, "/save-prompt.html")
  }

  show(token: string): void {
    this.overlay.show(token)
    this.overlay.placeTopRight()
  }

  resize(height: number): void {
    this.overlay.resize(height)
  }

  close(): void {
    this.overlay.hide()
  }
}

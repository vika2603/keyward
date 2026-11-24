import type { ContentScriptContext } from "wxt/utils/content-script-context"
import { isVisible } from "./fields"

const SIZE = 24
const INSET = 6
/** lucide "key", drawn at 16 px. */
const KEY_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m2 21 9.6-9.6"/><path d="m7.5 15.5 2.3 2.3a1 1 0 0 1 0 1.4l-2.1 2.1a1 1 0 0 1-1.4 0L4 19"/><circle cx="15.5" cy="7.5" r="5.5"/></svg>'

/*
 * Plain px values: the icons sit in the page, where rem units and the page's own styles would
 * otherwise change their size. The closed shadow root keeps page styles and scripts away.
 */
const STYLE = `
:host { all: initial; }
button {
  all: initial;
  position: fixed;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  width: ${SIZE}px;
  height: ${SIZE}px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #737373;
  opacity: 0.6;
  cursor: pointer;
}
button:hover, button[aria-expanded="true"] {
  background: color-mix(in srgb, currentColor 14%, transparent);
  opacity: 1;
}
`

/** The key icon inside each login field; activating one opens the menu for that field. */
export class FieldIcons {
  private readonly host: HTMLElement
  private readonly root: ShadowRoot
  private readonly icons = new Map<HTMLInputElement, HTMLButtonElement>()
  private frame = 0
  private expanded: HTMLInputElement | null = null

  constructor(
    ctx: ContentScriptContext,
    private readonly onActivate: (field: HTMLInputElement) => void,
  ) {
    this.host = document.createElement("keyward-field-icons")
    for (const [name, value] of Object.entries({
      position: "fixed",
      top: "0",
      left: "0",
      width: "0",
      height: "0",
      "z-index": "2147483646",
      display: "block",
    })) {
      this.host.style.setProperty(name, value, "important")
    }
    this.root = this.host.attachShadow({ mode: "closed" })
    const style = document.createElement("style")
    style.textContent = STYLE
    this.root.append(style)

    const schedule = () => this.schedule()
    ctx.addEventListener(window, "scroll", schedule, {
      capture: true,
      passive: true,
    })
    ctx.addEventListener(window, "resize", schedule, { passive: true })
    ctx.setInterval(schedule, 1000)
    ctx.onInvalidated(() => this.host.remove())
  }

  /** Shows icons for exactly these fields. */
  update(fields: HTMLInputElement[]): void {
    const wanted = new Set(fields)
    for (const [field, icon] of this.icons) {
      if (!wanted.has(field)) {
        icon.remove()
        this.icons.delete(field)
      }
    }
    for (const field of fields) {
      if (!this.icons.has(field)) this.icons.set(field, this.createIcon(field))
    }
    if (this.icons.size && !this.host.isConnected)
      document.documentElement.append(this.host)
    if (!this.icons.size) this.host.remove()
    this.schedule()
  }

  owns(target: EventTarget | null): boolean {
    return target === this.host
  }

  setExpanded(field: HTMLInputElement | null): void {
    this.expanded = field
    for (const [f, icon] of this.icons)
      icon.setAttribute("aria-expanded", String(f === field))
  }

  private createIcon(field: HTMLInputElement): HTMLButtonElement {
    const icon = document.createElement("button")
    icon.type = "button"
    icon.title = "Keyward"
    icon.setAttribute("aria-label", "打开密码菜单")
    icon.setAttribute("aria-expanded", String(this.expanded === field))
    icon.innerHTML = KEY_SVG
    // Keeps the focus in the field while the icon is pressed.
    icon.addEventListener("mousedown", (event) => event.preventDefault())
    icon.addEventListener("click", (event) => {
      if (!event.isTrusted) return
      event.preventDefault()
      event.stopPropagation()
      this.onActivate(field)
    })
    this.root.append(icon)
    return icon
  }

  private schedule(): void {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.position()
    })
  }

  private position(): void {
    for (const [field, icon] of this.icons) {
      const rect = field.getBoundingClientRect()
      const shown =
        isVisible(field) &&
        rect.height >= SIZE - 4 &&
        rect.bottom > 0 &&
        rect.top < innerHeight &&
        rect.right > 0 &&
        rect.left < innerWidth
      icon.style.display = shown ? "flex" : "none"
      if (!shown) continue
      // The field's own text color keeps the icon readable on light and dark pages.
      icon.style.color = getComputedStyle(field).color
      icon.style.left = `${Math.round(rect.right - INSET - SIZE)}px`
      icon.style.top = `${Math.round(rect.top + (rect.height - SIZE) / 2)}px`
    }
  }
}

import type { ContentScriptContext } from "wxt/utils/content-script-context"
import LOGO_SVG from "@/assets/field-icon.svg?raw"
import type { Language } from "@/lib/i18n/language"
import { deepActiveElement } from "./deep-dom"
import { codeBoxes, isVisible } from "./field-finder"

/** The icon's only text; kept here so the content script does not carry the whole catalog. */
const ICON_LABELS: Record<Language, string> = {
  "zh-CN": "打开密码菜单",
  en: "Open password menu",
}

const SIZE = 24
const INSET = 6
/** Narrower fields leave no room for both their text and the icon. */
const NARROW_WIDTH = SIZE * 3
const OUTSIDE_GAP = 6
/** Lower fields cannot hold the icon. */
const MIN_FIELD_HEIGHT = SIZE - 4
/** How many page controls over a field's end, such as a "show password" button, the icon moves past. */
const MAX_COVERS = 3
/** Room left between the icon and a page control over the field. */
const COVER_GAP = 4
/** Just below the overlays' z-index, the highest there is, so an open menu covers the icons. */
const ICON_Z_INDEX = "2147483646"

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
  opacity: 0.85;
  cursor: pointer;
}
button:hover, button[aria-expanded="true"] {
  background: color-mix(in srgb, currentColor 14%, transparent);
  opacity: 1;
}
`

/**
 * The page element drawn over a point of the field, such as a "show password" button, taken at the
 * outermost ancestor that does not contain the field. Wide covers, such as floating labels laid
 * over the whole field, do not count.
 */
function coveringElement(
  field: HTMLInputElement,
  pointX: number,
  pointY: number,
  ignore: Element,
): Element | null {
  const root = field.getRootNode() as Document | ShadowRoot
  const fieldRect = field.getBoundingClientRect()
  for (const element of root.elementsFromPoint(pointX, pointY)) {
    if (element === field || element.contains(field)) return null
    if (element === ignore) continue
    let outer = element
    while (outer.parentElement && !outer.parentElement.contains(field))
      outer = outer.parentElement
    return outer.getBoundingClientRect().width < fieldRect.width / 2
      ? outer
      : null
  }
  return null
}

/**
 * The Keyward icon inside a login field, shown while the field has the focus or its menu is open;
 * activating it opens the menu for that field.
 */
export class FieldIcons {
  private readonly host: HTMLElement
  private readonly root: ShadowRoot
  private readonly icons = new Map<HTMLInputElement, HTMLButtonElement>()
  private frame = 0
  private expanded: HTMLInputElement | null = null
  private language: Language = "en"

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
      "z-index": ICON_Z_INDEX,
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
    ctx.addEventListener(document, "focusin", schedule)
    ctx.addEventListener(document, "focusout", schedule)
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

  setLanguage(language: Language): void {
    this.language = language
    for (const icon of this.icons.values())
      icon.setAttribute("aria-label", ICON_LABELS[language])
  }

  owns(target: EventTarget | null): boolean {
    return target === this.host
  }

  setExpanded(field: HTMLInputElement | null): void {
    this.expanded = field
    for (const [iconField, icon] of this.icons)
      icon.setAttribute("aria-expanded", String(iconField === field))
    this.schedule()
  }

  private createIcon(field: HTMLInputElement): HTMLButtonElement {
    const icon = document.createElement("button")
    icon.type = "button"
    icon.title = "Keyward"
    icon.setAttribute("aria-label", ICON_LABELS[this.language])
    icon.setAttribute("aria-expanded", String(this.expanded === field))
    icon.innerHTML = LOGO_SVG
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

  /** The right edge for the icon: inside the field, left of page controls drawn over its end. */
  private freeRight(field: HTMLInputElement, rect: DOMRect): number {
    let right = rect.right - INSET
    const middleY = rect.top + rect.height / 2
    for (let step = 0; step < MAX_COVERS; step++) {
      const iconMiddleX = right - SIZE / 2
      if (iconMiddleX < rect.left + rect.width / 2) break
      const cover = coveringElement(field, iconMiddleX, middleY, this.host)
      if (!cover) break
      right = Math.min(right, cover.getBoundingClientRect().left) - COVER_GAP
    }
    return right
  }

  private position(): void {
    const focusedField = deepActiveElement()
    const focusedIcon = this.root.activeElement
    for (const [field, icon] of this.icons) {
      const inUse =
        field === focusedField ||
        field === this.expanded ||
        icon === focusedIcon
      if (!inUse) {
        icon.style.display = "none"
        continue
      }
      // A code split over one-character boxes, or a field too narrow to share with the icon, gets
      // the icon just after it, so the icon never covers what is typed.
      const boxes = codeBoxes(field)
      const last = boxes[boxes.length - 1] ?? field
      const rect = last.getBoundingClientRect()
      const outside = boxes.length > 1 || rect.width < NARROW_WIDTH
      const shown =
        isVisible(field) &&
        rect.height >= MIN_FIELD_HEIGHT &&
        rect.bottom > 0 &&
        rect.top < innerHeight &&
        rect.right > 0 &&
        rect.left < innerWidth
      icon.style.display = shown ? "flex" : "none"
      if (!shown) continue
      // The field's own text color keeps the icon readable on light and dark pages.
      icon.style.color = getComputedStyle(field).color
      icon.style.left = `${Math.round(
        outside
          ? Math.min(rect.right + OUTSIDE_GAP, innerWidth - SIZE)
          : this.freeRight(field, rect) - SIZE,
      )}px`
      icon.style.top = `${Math.round(rect.top + (rect.height - SIZE) / 2)}px`
    }
  }
}

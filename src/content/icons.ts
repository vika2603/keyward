import type { ContentScriptContext } from "wxt/utils/content-script-context"
import LOGO_SVG from "@/assets/field-icon.svg?raw"
import type { Language } from "@/lib/i18n/language"
import { deepActiveElement, markOwnHost, openDialogOf } from "./deep-dom"
import { isContextAlive } from "./extension-messages"
import { codeBoxes, isVisible } from "./field-finder"
import type { PageEvents } from "./page-events"

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

const px = (value: string) => Number.parseFloat(value) || 0

/**
 * How far before the field's right edge the icon ends. A right padding wider than the left one is
 * room the page keeps for a control of its own, such as Apple's arrow button, which may take no
 * pointer events and so escape `coveringElement`; the icon ends where that room begins.
 */
function endInset(style: CSSStyleDeclaration): number {
  const paddingRight = px(style.paddingRight)
  return paddingRight > px(style.paddingLeft)
    ? Math.max(INSET, px(style.borderRightWidth) + paddingRight)
    : INSET
}

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

function promotePopover(element: HTMLElement): void {
  if (typeof element.showPopover !== "function") return
  try {
    if (!element.matches(":popover-open")) element.showPopover()
  } catch {
    // Ignore when the element is disconnected or popover promotion is unavailable.
  }
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
    private readonly ctx: ContentScriptContext,
    events: PageEvents,
    private readonly onActivate: (field: HTMLInputElement) => void,
  ) {
    this.host = document.createElement("keyward-field-icons")
    if (typeof this.host.showPopover === "function")
      this.host.setAttribute("popover", "manual")
    this.host.style.setProperty("all", "initial", "important")
    for (const [name, value] of Object.entries({
      position: "fixed",
      top: "0",
      left: "0",
      width: "0",
      height: "0",
      overflow: "visible",
      "z-index": ICON_Z_INDEX,
      display: "block",
    })) {
      this.host.style.setProperty(name, value, "important")
    }
    this.root = this.host.attachShadow({ mode: "closed" })
    markOwnHost(this.host)
    const style = document.createElement("style")
    style.textContent = STYLE
    this.root.append(style)

    const schedule = () => this.schedule()
    ctx.addEventListener(window, "scroll", schedule, {
      capture: true,
      passive: true,
    })
    ctx.addEventListener(window, "resize", schedule, { passive: true })
    events.on("focusin", schedule)
    events.on("focusout", schedule)
    ctx.setInterval(schedule, 1000)
    ctx.onInvalidated(() => {
      cancelAnimationFrame(this.frame)
      this.frame = 0
      this.host.remove()
    })
  }

  /** Shows icons for exactly these fields. */
  update(fields: HTMLInputElement[]): void {
    if (!isContextAlive(this.ctx)) return
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
    if (this.icons.size) {
      if (!this.host.isConnected) {
        document.documentElement.append(this.host)
        promotePopover(this.host)
      }
    } else {
      this.host.remove()
    }
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
    // Mount/promote the icon host before InlineMenu.show() promotes its popover, so the menu
    // always sits above the icon host in the browser's top layer.
    if (field) this.mountHostFor(field)
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

  /**
   * The right edge for the icon: inside the field, before the room its padding keeps for a page
   * control, and left of page controls drawn over its end.
   */
  private freeRight(
    field: HTMLInputElement,
    rect: DOMRect,
    style: CSSStyleDeclaration,
  ): number {
    let right = rect.right - endInset(style)
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

  private mountHostFor(activeField: HTMLInputElement | null): void {
    if (!this.icons.size) return
    const target =
      (activeField ? openDialogOf(activeField) : null) ??
      document.documentElement
    if (this.host.parentElement !== target) target.append(this.host)
    promotePopover(this.host)
  }

  private position(): void {
    if (!isContextAlive(this.ctx)) return
    const focusedField = deepActiveElement()
    const focusedIcon = this.root.activeElement
    let activeField: HTMLInputElement | null = null
    for (const [field, icon] of this.icons) {
      if (
        field === focusedField ||
        field === this.expanded ||
        icon === focusedIcon
      ) {
        activeField = field
        break
      }
    }
    this.mountHostFor(activeField)
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
      const style = getComputedStyle(field)
      // The field's own text color keeps the icon readable on light and dark pages.
      icon.style.color = style.color
      icon.style.left = `${Math.round(
        outside
          ? Math.min(rect.right + OUTSIDE_GAP, innerWidth - SIZE)
          : this.freeRight(field, rect, style) - SIZE,
      )}px`
      icon.style.top = `${Math.round(rect.top + (rect.height - SIZE) / 2)}px`
    }
  }
}

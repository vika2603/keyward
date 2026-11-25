import type { ContentScriptContext } from "wxt/utils/content-script-context"
import { type FoundFields, findFields } from "./field-finder"

/** How long a scan waits after a change to the page, so that a burst of changes scans once. */
const SCAN_DELAY_MS = 300
/** Changes inside shadow roots do not reach the page observer; a slow rescan picks them up. */
const RESCAN_MS = 2000

const NO_FIELDS: FoundFields = { login: [], newPassword: [], code: [] }

/**
 * Keeps the page's login, new-password and code fields up to date while the page changes. Code
 * fields count only while a ready vault has one-time codes for the page.
 */
export class FieldTracker {
  private fields = NO_FIELDS
  /** Whether code fields count; null until the background was asked. */
  private codesAvailable: boolean | null = null
  private askingCodes = false
  private running = false
  private observer: MutationObserver | null = null
  private scanTimer = 0
  private rescanTimer = 0

  constructor(
    private readonly ctx: ContentScriptContext,
    private readonly options: {
      /** Keyward's own elements in the page, whose changes need no scan. */
      isKeywardNode: (node: Node) => boolean
      /** Whether a ready vault has one-time codes for the frame; null when the answer no longer counts. */
      askCodes: () => Promise<boolean | null>
      /** Called after every scan, and with no fields once tracking stops. */
      onScan: (fields: FoundFields) => void
    },
  ) {
    ctx.onInvalidated(() => {
      this.observer?.disconnect()
      clearTimeout(this.scanTimer)
    })
  }

  get login(): readonly HTMLInputElement[] {
    return this.fields.login
  }

  get newPassword(): readonly HTMLInputElement[] {
    return this.fields.newPassword
  }

  get code(): readonly HTMLInputElement[] {
    return this.fields.code
  }

  has(field: HTMLInputElement): boolean {
    return (
      this.isLogin(field) || this.isNewPassword(field) || this.isCode(field)
    )
  }

  isLogin(field: HTMLInputElement): boolean {
    return this.fields.login.includes(field)
  }

  isNewPassword(field: HTMLInputElement): boolean {
    return this.fields.newPassword.includes(field)
  }

  isCode(field: HTMLInputElement): boolean {
    return this.fields.code.includes(field)
  }

  start(): void {
    this.running = true
    this.observer = new MutationObserver((records) => {
      if (this.scanTimer || records.every(this.isKeywardChange)) return
      this.scanTimer = window.setTimeout(() => {
        this.scanTimer = 0
        this.scan()
      }, SCAN_DELAY_MS)
    })
    this.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["type", "style", "class", "hidden", "disabled"],
    })
    this.rescanTimer = this.ctx.setInterval(() => this.scan(), RESCAN_MS)
    this.scan()
  }

  stop(): void {
    this.running = false
    this.observer?.disconnect()
    this.observer = null
    clearInterval(this.rescanTimer)
    clearTimeout(this.scanTimer)
    this.scanTimer = 0
    this.fields = NO_FIELDS
    this.options.onScan(this.fields)
  }

  scan(): void {
    const found = findFields(document)
    if (found.code.length && this.codesAvailable === null)
      void this.checkCodes()
    this.fields = { ...found, code: this.codesAvailable ? found.code : [] }
    this.options.onScan(this.fields)
  }

  /**
   * Asks again whether code fields count. A configuration follows every change of the vaults, so
   * an unlock after the page loaded shows the code fields' icon too.
   */
  forgetCodes(): void {
    this.codesAvailable = null
  }

  /** Asks once whether code fields count, and scans again when they do. */
  private async checkCodes(): Promise<void> {
    if (this.askingCodes) return
    this.askingCodes = true
    const available = await this.options.askCodes()
    this.askingCodes = false
    if (available === null || this.ctx.isInvalid || !this.running) return
    this.codesAvailable = available
    if (available) this.scan()
  }

  /** Keyward's icons and overlays change with every move of the menu; they hold no fields. */
  private readonly isKeywardChange = (record: MutationRecord): boolean =>
    record.type === "childList"
      ? [...record.addedNodes, ...record.removedNodes].every(
          this.options.isKeywardNode,
        )
      : this.options.isKeywardNode(record.target)
}

import type { ContentScriptContext } from "wxt/utils/content-script-context"
import { hasPendingShadowHosts } from "./deep-dom"
import { isContextAlive } from "./extension-messages"
import { type FoundFields, findFields } from "./field-finder"

/** How long a scan waits after a change to the page, so that a burst of changes scans once. */
const SCAN_DELAY_MS = 300
/** Initial delay before re-checking custom elements awaiting shadow-root hydration. */
const HYDRATION_INITIAL_MS = 500
/** Upper bound for exponential backoff while waiting for custom elements to hydrate. */
const HYDRATION_MAX_MS = 8000

const OBSERVE_OPTIONS: MutationObserverInit = {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: [
    "type",
    "style",
    "class",
    "hidden",
    "disabled",
    "readonly",
    "open",
  ],
}

const NO_FIELDS: FoundFields = { login: [], newPassword: [], code: [] }

/**
 * Keeps the page's login, new-password and code fields up to date while the page changes.
 * Discovered shadow roots are observed directly; custom elements still awaiting shadow-root
 * hydration are polled with bounded exponential backoff instead of an unbounded interval.
 */
export class FieldTracker {
  private fields = NO_FIELDS
  /** Whether code fields count; null until the background was asked. */
  private codesAvailable: boolean | null = null
  private askingCodes = false
  private running = false
  private observer: MutationObserver | null = null
  private observedRoots = new WeakSet<Node>()
  private scanTimer = 0
  private hydrationTimer = 0
  private hydrationDelayMs = HYDRATION_INITIAL_MS

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
      clearTimeout(this.hydrationTimer)
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
    if (!isContextAlive(this.ctx)) return
    this.running = true
    this.observedRoots = new WeakSet<Node>()
    this.observer = new MutationObserver((records) => {
      if (!isContextAlive(this.ctx)) return
      if (this.scanTimer || records.every(this.isKeywardChange)) return
      this.hydrationDelayMs = HYDRATION_INITIAL_MS
      this.scanTimer = window.setTimeout(() => {
        this.scanTimer = 0
        this.scan()
      }, SCAN_DELAY_MS)
    })
    this.observeRoot(document.documentElement)
    this.scan()
  }

  stop(): void {
    this.running = false
    this.observer?.disconnect()
    this.observer = null
    this.observedRoots = new WeakSet<Node>()
    clearTimeout(this.hydrationTimer)
    this.hydrationTimer = 0
    clearTimeout(this.scanTimer)
    this.scanTimer = 0
    this.fields = NO_FIELDS
    this.options.onScan(this.fields)
  }

  scan(): void {
    if (!isContextAlive(this.ctx)) return
    const found = findFields(document, (root) => this.observeRoot(root))
    if (found.code.length && this.codesAvailable === null)
      void this.checkCodes()
    this.fields = { ...found, code: this.codesAvailable ? found.code : [] }
    this.options.onScan(this.fields)
    this.scheduleHydrationCheck()
  }

  /**
   * Asks again whether code fields count. A configuration follows every change of the vaults, so
   * an unlock after the page loaded shows the code fields' icon too.
   */
  forgetCodes(): void {
    this.codesAvailable = null
  }

  private observeRoot(root: Node): void {
    if (!this.observer || this.observedRoots.has(root)) return
    this.observedRoots.add(root)
    this.observer.observe(root, OBSERVE_OPTIONS)
  }

  /** Re-scans with exponential backoff only while custom elements are awaiting shadow roots. */
  private scheduleHydrationCheck(): void {
    clearTimeout(this.hydrationTimer)
    this.hydrationTimer = 0
    if (!this.running || !hasPendingShadowHosts()) {
      this.hydrationDelayMs = HYDRATION_INITIAL_MS
      return
    }
    const delay = this.hydrationDelayMs
    this.hydrationDelayMs = Math.min(delay * 2, HYDRATION_MAX_MS)
    this.hydrationTimer = window.setTimeout(() => {
      this.hydrationTimer = 0
      if (this.running) this.scan()
    }, delay)
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

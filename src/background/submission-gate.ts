import { siteDomainOf } from "@/lib/site"
import { frameUrl } from "./page"
import type { SubmittedLoginInput } from "./save-prompt"

/** Flush a submission if no auth-relevant network request starts within this window. */
export const NO_REQUEST_TIMEOUT_MS = 1200
/** Wait briefly after a 2xx XHR so a fast redirect or follow-up error can still take over. */
export const SETTLE_AFTER_OK_MS = 250
/** Maximum time to wait for a PRG navigation or in-flight auth request to finish. */
export const NAV_MAX_WAIT_MS = 5000

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH"])

interface RequestDetails {
  tabId: number
  url: string
  method: string
  type: string
  statusCode?: number
  error?: string
}

interface PendingSubmission {
  tabId: number
  frameId: number
  page: URL
  site: string
  submitted: SubmittedLoginInput
  awaitingComplete: boolean
  timer: ReturnType<typeof setTimeout>
}

export type ReadySubmissionHandler = (
  tabId: number,
  frameId: number,
  submitted: SubmittedLoginInput,
  page: URL,
) => Promise<void> | void

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

/**
 * Delays showing a save prompt until the site's login request or Post-Redirect-Get navigation
 * finishes, discarding submissions whose auth request returns 4xx/5xx or fails on the network.
 * Falls back after a short timeout when a page signs in without an observed HTTP request.
 */
export class SubmissionGate {
  private readonly pending = new Map<number, PendingSubmission>()

  constructor(private readonly onReady: ReadySubmissionHandler) {}

  async submit(
    tabId: number,
    frameId: number,
    submitted: SubmittedLoginInput,
    knownPage?: URL,
  ): Promise<void> {
    const page = knownPage ?? (await frameUrl(tabId, frameId))
    if (!page) return
    // Username-only steps never show a prompt and must be remembered before the next step loads.
    if (!submitted.password) {
      await this.onReady(tabId, frameId, submitted, page)
      return
    }
    this.cancel(tabId)
    const entry: PendingSubmission = {
      tabId,
      frameId,
      page,
      site: siteDomainOf(page.hostname),
      submitted,
      awaitingComplete: false,
      timer: setTimeout(() => void this.flush(tabId), NO_REQUEST_TIMEOUT_MS),
    }
    this.pending.set(tabId, entry)
  }

  onBeforeRequest(details: RequestDetails): void {
    const entry = this.pending.get(details.tabId)
    if (!entry || !this.isRelevant(entry, details)) return
    if (details.type === "main_frame") entry.awaitingComplete = true
    this.reschedule(entry, NAV_MAX_WAIT_MS)
  }

  onBeforeRedirect(details: RequestDetails): void {
    const entry = this.pending.get(details.tabId)
    if (!entry || !this.isRelevant(entry, details)) return
    if (details.type === "main_frame") {
      entry.awaitingComplete = true
      this.reschedule(entry, NAV_MAX_WAIT_MS)
    }
  }

  onCompleted(details: RequestDetails): void {
    const entry = this.pending.get(details.tabId)
    if (!entry || !this.isRelevant(entry, details)) return
    const status = details.statusCode ?? 0
    if (status >= 400) {
      this.cancel(details.tabId)
      return
    }
    if (status >= 200 && status < 400) {
      if (details.type === "main_frame") {
        entry.awaitingComplete = true
        this.reschedule(entry, NAV_MAX_WAIT_MS)
      } else if (!entry.awaitingComplete) {
        this.reschedule(entry, SETTLE_AFTER_OK_MS)
      }
    }
  }

  onErrorOccurred(details: RequestDetails): void {
    const entry = this.pending.get(details.tabId)
    if (!entry || !this.isRelevant(entry, details)) return
    // A redirect or page navigation frequently cancels in-flight requests with ERR_ABORTED.
    if (details.error === "net::ERR_ABORTED") return
    this.cancel(details.tabId)
  }

  onTabUpdated(tabId: number, status?: string): void {
    const entry = this.pending.get(tabId)
    if (!entry) return
    if (status === "loading") {
      entry.awaitingComplete = true
      this.reschedule(entry, NAV_MAX_WAIT_MS)
    } else if (status === "complete" && entry.awaitingComplete) {
      void this.flush(tabId)
    }
  }

  cancel(tabId: number): void {
    const entry = this.pending.get(tabId)
    if (!entry) return
    clearTimeout(entry.timer)
    this.pending.delete(tabId)
  }

  private reschedule(entry: PendingSubmission, delayMs: number): void {
    clearTimeout(entry.timer)
    entry.timer = setTimeout(() => void this.flush(entry.tabId), delayMs)
  }

  private async flush(tabId: number): Promise<void> {
    const entry = this.pending.get(tabId)
    if (!entry) return
    clearTimeout(entry.timer)
    this.pending.delete(tabId)
    await Promise.resolve(
      this.onReady(entry.tabId, entry.frameId, entry.submitted, entry.page),
    ).catch(() => {})
  }

  private isRelevant(
    entry: PendingSubmission,
    details: RequestDetails,
  ): boolean {
    const method = details.method.toUpperCase()
    if (details.type === "main_frame" || details.type === "sub_frame")
      return MUTATING_METHODS.has(method) || entry.awaitingComplete
    if (details.type === "xmlhttprequest") {
      if (!MUTATING_METHODS.has(method)) return false
      const host = hostOf(details.url)
      return host !== null && siteDomainOf(host) === entry.site
    }
    return false
  }
}

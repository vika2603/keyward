import { BackendError } from "@/lib/backends/types"
import type { Sender } from "@/lib/messaging"
import type { FieldKind } from "./api"

interface OverlayBase {
  tabId: number
  /** The page frame whose content script shows the overlay. */
  frameId: number
  /** Posted by the content script only to the frame it created; requests carry it as proof. */
  token: string
  /** The frame of the overlay page that took over the session, once it has loaded. */
  overlayFrameId: number | null
}

/**
 * State of the in-page overlays, one per tab and kind, kept in storage.session so it survives a
 * restart of the service worker. The overlay pages are web-accessible, so a web page can embed
 * them too; they hold no data of their own and must present the session's token, which reaches
 * only the frame the content script created. The first frame to present it claims the session.
 */
export class OverlaySessions<T extends OverlayBase> {
  constructor(private readonly kind: string) {}

  private key(tabId: number): string {
    return `overlay.${this.kind}.${tabId}`
  }

  async get(tabId: number): Promise<T | null> {
    const key = this.key(tabId)
    return (
      ((await browser.storage.session.get(key))[key] as T | undefined) ?? null
    )
  }

  async set(session: T): Promise<void> {
    await browser.storage.session.set({ [this.key(session.tabId)]: session })
  }

  async remove(tabId: number): Promise<void> {
    await browser.storage.session.remove(this.key(tabId))
  }

  /** The session of the overlay frame that sent a request; claims an unclaimed one. */
  async claim(sender: Sender, token: unknown): Promise<T> {
    const tabId = sender.tab?.id
    const frameId = sender.frameId
    if (tabId === undefined || frameId === undefined) throw forbidden()
    const session = await this.get(tabId)
    if (!session) throw new BackendError("Nothing to show", "overlay.closed")
    if (typeof token !== "string" || !token || token !== session.token)
      throw forbidden()
    if (session.overlayFrameId === frameId) return session
    if (session.overlayFrameId !== null) throw forbidden()
    const claimed = { ...session, overlayFrameId: frameId }
    await this.set(claimed)
    return claimed
  }
}

function forbidden(): BackendError {
  return new BackendError(
    "This overlay does not belong to the session",
    "forbidden",
  )
}

export interface MenuSession extends OverlayBase {
  kind: FieldKind
}

export interface PromptSession extends OverlayBase {
  mode: "save" | "update"
  url: string
  username: string
  password: string
  /** For updates: the source and login whose password changes. */
  update: { sourceId: string; loginId: string } | null
  createdAt: number
}

export const menus = new OverlaySessions<MenuSession>("menu")
export const prompts = new OverlaySessions<PromptSession>("prompt")

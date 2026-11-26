import type { ContentScriptContext } from "wxt/utils/content-script-context"
import {
  PASSKEY_CONTROL_EVENT,
  PASSKEY_STATE_EVENT,
  type PasskeyControl,
} from "./passkey-events"

/** Talks to the page-world script that holds a page's passkey request for Keyward's menu. */
export class PasskeySteering {
  private requestWaiting = false
  private mode: PasskeyControl | null = null

  constructor(
    ctx: ContentScriptContext,
    options: {
      /** The page-world script started or stopped holding a request. */
      onWaitingChange: () => void
    },
  ) {
    ctx.addEventListener(document, PASSKEY_STATE_EVENT, (event) => {
      const waiting = (event as CustomEvent<unknown>).detail === "waiting"
      if (waiting === this.requestWaiting) return
      this.requestWaiting = waiting
      options.onWaitingChange()
    })
    // The menu of this copy is gone; a newer copy of the script takes over in new pages only.
    ctx.onInvalidated(() => this.control("release"))
  }

  /** Whether the page-world script holds a passkey request for the menu. */
  get waiting(): boolean {
    return this.requestWaiting
  }

  /**
   * Keeps the page's passkey request for the menu while `hold` is true, as while this frame shows
   * the menu on login fields; otherwise the browser lists passkeys itself.
   */
  steer(hold: boolean): void {
    const next = hold ? "hold" : "release"
    if (next === this.mode) return
    this.mode = next
    this.control(next)
  }

  /** Has the browser sign in with the held request now. */
  use(): void {
    this.control("use")
  }

  private control(control: PasskeyControl): void {
    document.dispatchEvent(
      new CustomEvent(PASSKEY_CONTROL_EVENT, { detail: control }),
    )
  }
}

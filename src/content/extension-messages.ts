import type { ContentScriptContext } from "wxt/utils/content-script-context"
import { type BackgroundApi, callBackground } from "@/background/api"

type Notice = {
  [K in keyof BackgroundApi]: BackgroundApi[K]["result"] extends null
    ? K
    : never
}[keyof BackgroundApi]

/**
 * Tells the background something that needs no answer. A failure is dropped: the background may be
 * restarting, or the extension reloading, and the next notice tells it again.
 */
export function notifyBackground<K extends Notice>(
  type: K,
  payload: BackgroundApi[K]["payload"],
): void {
  void callBackground(type, payload).catch(() => {})
}

interface ExtensionEvent<Listener> {
  addListener(listener: Listener): void
  removeListener(listener: Listener): void
}

/**
 * Whether the extension context is still live. After an extension reload, `browser.runtime?.id`
 * disappears before a newer copy of the content script takes over (or when a tab is not
 * re-injected); aborting `ctx` tears down observers, timers and overlays cleanly instead of
 * throwing `Extension context invalidated`.
 */
export function isContextAlive(ctx: ContentScriptContext): boolean {
  if (ctx.isInvalid) return false
  if (browser.runtime?.id) return true
  ctx.abort("Extension context invalidated")
  return false
}

/**
 * Listens to an extension event until a newer copy of this script takes over. After the extension
 * reloads, its APIs throw and its events stop, so there is nothing to remove.
 */
export function listenToExtension<Listener>(
  ctx: ContentScriptContext,
  event: ExtensionEvent<Listener>,
  listener: Listener,
): void {
  event.addListener(listener)
  ctx.onInvalidated(() => {
    if (browser.runtime?.id) event.removeListener(listener)
  })
}

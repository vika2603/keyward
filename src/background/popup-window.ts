import { storage } from "wxt/utils/storage"
import type { PopupView } from "./api"

/** The view the popup opens on next, set by a command or the in-page menu. */
const requestedViewItem = storage.defineItem<PopupView>("session:popup.view")

/** Opens the toolbar popup on a given view, in a popup window when the browser refuses. */
export async function openPopup(view: PopupView): Promise<void> {
  await requestedViewItem.setValue(view)
  try {
    await browser.action.openPopup()
  } catch {
    await browser.windows.create({
      url: browser.runtime.getURL("/popup.html"),
      type: "popup",
      width: 400,
      height: 600,
    })
  }
}

/** The view the popup was last asked to open on, which it takes once. */
export async function takeRequestedView(): Promise<PopupView | null> {
  const requested = await requestedViewItem.getValue()
  await requestedViewItem.removeValue()
  return requested
}

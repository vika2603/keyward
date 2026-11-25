import type { PopupView } from "./api"

const POPUP_VIEW_KEY = "popup.view"

/** Opens the toolbar popup on a given view, in a popup window when the browser refuses. */
export async function openPopup(view: PopupView): Promise<void> {
  await browser.storage.session.set({ [POPUP_VIEW_KEY]: view })
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
  const stored = (await browser.storage.session.get(POPUP_VIEW_KEY))[
    POPUP_VIEW_KEY
  ]
  await browser.storage.session.remove(POPUP_VIEW_KEY)
  return (stored as PopupView | undefined) ?? null
}

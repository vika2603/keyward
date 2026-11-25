import { createContext, useContext } from "react"

/** The view the popup was popped out on, handed to the window that opens next. */
const POPPED_VIEW_KEY = "popup.poppedView"

/** The popup's size; a popped-out window is fitted to it. */
const WIDTH = 380
const HEIGHT = 600

/** Whether this page runs in a window of its own rather than as the toolbar popup. */
export const isPoppedOut = new URLSearchParams(location.search).has("window")

/**
 * Opens the popup's current view in a window of its own and closes the popup. Unlike the popup,
 * the window stays open when another window takes the focus.
 */
export async function popOut(view: object): Promise<void> {
  await browser.storage.session.set({ [POPPED_VIEW_KEY]: withoutItems(view) })
  await browser.windows.create({
    url: browser.runtime.getURL("/popup.html?window"),
    type: "popup",
    width: WIDTH,
    height: HEIGHT,
    focused: true,
  })
  window.close()
}

/** A view's vault without the item lists a list view carries along, which can be long. */
function withoutItems(view: object): object {
  const vault = (view as { vault?: Record<string, unknown> }).vault
  if (!vault) return view
  const { id, kind, label, status, error } = vault
  return { ...view, vault: { id, kind, label, status, error } }
}

/** The view to open with, once; null when the window was not opened by a pop-out. */
export async function takePoppedView(): Promise<unknown> {
  const view = (await browser.storage.session.get(POPPED_VIEW_KEY))[
    POPPED_VIEW_KEY
  ]
  await browser.storage.session.remove(POPPED_VIEW_KEY)
  return view ?? null
}

/** Sizes the window so its content area matches the popup's, whatever the window frame takes. */
export async function fitWindow(): Promise<void> {
  const current = await browser.windows.getCurrent()
  if (current.id === undefined) return
  await browser.windows.update(current.id, {
    width: WIDTH + (outerWidth - innerWidth),
    height: HEIGHT + (outerHeight - innerHeight),
  })
}

/** Pops the current view out; null in a window that is popped out already. */
export const PopOutContext = createContext<(() => void) | null>(null)

export function usePopOut(): (() => void) | null {
  return useContext(PopOutContext)
}

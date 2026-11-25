import { type RefObject, useEffect } from "react"

/**
 * Sends a copy of text selected inside `container` through `copy` instead of the browser, so that
 * the whole password reaches the clipboard and is cleared later like one copied with the button.
 * `copy` gets the element the selection starts in.
 */
export function useCopyThrough(
  container: RefObject<HTMLElement | null>,
  copy: (from: Element) => void,
): void {
  useEffect(() => {
    const onCopy = (event: ClipboardEvent) => {
      const node = document.getSelection()?.anchorNode
      const from = node instanceof Element ? node : node?.parentElement
      if (!from || !container.current?.contains(from)) return
      event.preventDefault()
      copy(from)
    }
    document.addEventListener("copy", onCopy)
    return () => document.removeEventListener("copy", onCopy)
  }, [container, copy])
}

/**
 * Writes the clipboard for the background, which has no document of its own. A copy event lets
 * the text be set exactly, including the empty text that clears a copied password.
 */
function copy(text: string): boolean {
  const onCopy = (event: ClipboardEvent) => {
    event.preventDefault()
    event.clipboardData?.setData("text/plain", text)
  }
  document.addEventListener("copy", onCopy)
  try {
    return document.execCommand("copy")
  } finally {
    document.removeEventListener("copy", onCopy)
  }
}

browser.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id) return false
    const request = message as {
      keywardOffscreen?: unknown
      text?: unknown
    } | null
    if (request?.keywardOffscreen !== 1 || typeof request.text !== "string")
      return false
    sendResponse({ ok: copy(request.text) })
    return false
  },
)

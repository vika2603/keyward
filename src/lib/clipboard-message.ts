/**
 * The background's request to its offscreen document to put text on the clipboard. It is marked
 * apart from the background's own requests, which the offscreen document leaves alone.
 */
export interface ClipboardWrite {
  keywardOffscreen: 1
  text: string
}

export function clipboardWrite(text: string): ClipboardWrite {
  return { keywardOffscreen: 1, text }
}

export function isClipboardWrite(message: unknown): message is ClipboardWrite {
  const candidate = message as Partial<ClipboardWrite> | null
  return candidate?.keywardOffscreen === 1 && typeof candidate.text === "string"
}

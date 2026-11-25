import { clipboardWrite } from "@/lib/clipboard-message"
import { getSettings } from "@/lib/settings"

const OFFSCREEN_PATH = "/offscreen.html"
export const CLEAR_CLIPBOARD_ALARM = "clearClipboard"

let creating: Promise<void> | null = null

/** Clipboard writes go through an offscreen document, so they work after the popup has closed. */
async function ensureOffscreen(): Promise<void> {
  const url = browser.runtime.getURL(OFFSCREEN_PATH)
  const contexts = await browser.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT" as Browser.runtime.ContextType],
    documentUrls: [url],
  })
  if (contexts.length) return
  creating ??= browser.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: ["CLIPBOARD" as Browser.offscreen.Reason],
      justification:
        "Copy logins to the clipboard and clear them after a while",
    })
    .finally(() => {
      creating = null
    })
  await creating
}

async function write(text: string): Promise<void> {
  await ensureOffscreen()
  const reply = (await browser.runtime.sendMessage(clipboardWrite(text))) as
    | { ok: boolean }
    | undefined
  if (!reply?.ok) throw new Error("Could not write to the clipboard")
}

/** Copies text; a secret is overwritten after the time set in the settings. */
export async function copyText(text: string, secret: boolean): Promise<void> {
  await write(text)
  // Text that is not secret replaced whatever secret the clipboard held, so its clear is dropped.
  if (!secret) {
    await browser.alarms.clear(CLEAR_CLIPBOARD_ALARM)
    return
  }
  const { clipboardClearSeconds } = await getSettings()
  if (clipboardClearSeconds === null) return
  await browser.alarms.create(CLEAR_CLIPBOARD_ALARM, {
    when: Date.now() + clipboardClearSeconds * 1000,
  })
}

export function clearClipboard(): Promise<void> {
  return write("")
}

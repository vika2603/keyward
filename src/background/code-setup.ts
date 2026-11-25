import jsQR from "jsqr"
import { BackendError } from "@/lib/backends/types"
import { type Language, resolveLanguage } from "@/lib/i18n/language"
import { getSettings, settingsItem } from "@/lib/settings"
import { oneTimeCode } from "@/lib/totp"
import type { PopupView } from "./api"
import { webPage } from "./page"

const MENU_ID = "setUpCode"
/** The menu's only text; kept here so the background does not carry the whole catalog. */
const MENU_TITLES: Record<Language, string> = {
  "zh-CN": "用 Keyward 设置验证码",
  en: "Set Up Verification Code with Keyward",
}
const PENDING_KEY = "codeSetup.pending"
/** A key picked from a page is set up within this time, or picked again. */
const PENDING_MAX_AGE_MS = 10 * 60_000
const MAX_URI_LENGTH = 4096
/** A PNG of at most 800 by 800 pixels, as the content script sends it. */
const MAX_IMAGE_LENGTH = 4_000_000
const IMAGE_PREFIX = "data:image/png;base64,"

/** The key a page offers under the pointer, per tab; it never leaves the background. */
const candidates = new Map<number, { uri: string; frameId: number }>()

/** An authenticator key picked from a page, waiting for the popup to say where it goes. */
export interface PendingSetup {
  uri: string
  /** The page of the tab the key was picked on. */
  site: string
  at: number
}

/** The URI if text is an `otpauth://totp/` key that codes can be made from. */
export function setupUri(text: string): string | null {
  const uri = text.trim()
  if (!/^otpauth:\/\/totp\//i.test(uri) || uri.length > MAX_URI_LENGTH)
    return null
  try {
    oneTimeCode(uri)
    return uri
  } catch {
    return null
  }
}

/** The text of a QR code in a PNG, read on a white background so transparent codes read too. */
async function decodeQr(dataUrl: string): Promise<string | null> {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob())
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const context = canvas.getContext("2d")
  if (!context) return null
  context.fillStyle = "#ffffff"
  context.fillRect(0, 0, bitmap.width, bitmap.height)
  context.drawImage(bitmap, 0, 0)
  const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height)
  return (
    jsQR(data, bitmap.width, bitmap.height, {
      inversionAttempts: "attemptBoth",
    })?.data ?? null
  )
}

/**
 * Records what a frame offers under the pointer: a link's URI or a picture that may be a QR code.
 * The menu item shows while a key was found; returns whether one was.
 */
export async function offerCandidate(
  tabId: number,
  frameId: number,
  candidate: { uri?: unknown; image?: unknown },
): Promise<boolean> {
  let uri: string | null = null
  if (typeof candidate.uri === "string") uri = setupUri(candidate.uri)
  else if (
    typeof candidate.image === "string" &&
    candidate.image.startsWith(IMAGE_PREFIX) &&
    candidate.image.length <= MAX_IMAGE_LENGTH
  ) {
    const text = await decodeQr(candidate.image).catch(() => null)
    uri = text ? setupUri(text) : null
  }
  if (uri) candidates.set(tabId, { uri, frameId })
  else candidates.delete(tabId)
  await showMenu(uri !== null)
  return uri !== null
}

async function showMenu(visible: boolean): Promise<void> {
  await browser.contextMenus.update(MENU_ID, { visible }).catch(() => {})
}

export async function pendingSetup(): Promise<{
  uri: string
  page: URL
}> {
  const pending = (await browser.storage.session.get(PENDING_KEY))[
    PENDING_KEY
  ] as PendingSetup | undefined
  const page = pending ? webPage(pending.site) : null
  if (!pending || !page || Date.now() - pending.at > PENDING_MAX_AGE_MS) {
    throw new BackendError("No verification code to set up", "noSetup")
  }
  return { uri: pending.uri, page }
}

export async function finishSetup(): Promise<void> {
  await browser.storage.session.remove(PENDING_KEY)
}

/**
 * Adds the "set up verification code" item to the page's context menu. It is shown only while the
 * pointer is on a QR code or link with an authenticator key; choosing it opens the popup, which
 * asks where the key goes.
 */
export function watchCodeSetup(openPopup: (view: PopupView) => void): void {
  const create = async () => {
    const { language } = await getSettings()
    await browser.contextMenus.removeAll()
    browser.contextMenus.create({
      id: MENU_ID,
      title: MENU_TITLES[resolveLanguage(language)],
      contexts: ["all"],
      visible: false,
    })
  }
  void create().catch(() => {})
  settingsItem.watch((next, previous) => {
    if (next?.language !== previous?.language)
      void browser.contextMenus
        .update(MENU_ID, {
          title: MENU_TITLES[resolveLanguage(next?.language ?? "system")],
        })
        .catch(() => {})
  })

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_ID || tab?.id === undefined) return
    const candidate = candidates.get(tab.id)
    const page = webPage(tab.url)
    if (!candidate || candidate.frameId !== info.frameId || !page) return
    const pending: PendingSetup = {
      uri: candidate.uri,
      site: page.href,
      at: Date.now(),
    }
    void browser.storage.session
      .set({ [PENDING_KEY]: pending })
      .then(() => openPopup({ name: "codeSetup" }))
  })
  // The item belongs to what the pointer is on in one tab.
  browser.tabs.onActivated.addListener(() => {
    candidates.clear()
    void showMenu(false)
  })
  browser.tabs.onRemoved.addListener((tabId) => candidates.delete(tabId))
}

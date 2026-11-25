import type { VaultView } from "./api"
import { activeTab, webPage } from "./page"
import type { Providers } from "./providers"

const ICON_SIZES = [16, 32] as const
const READY_ICON = Object.fromEntries(
  ICON_SIZES.map((size) => [size, `/icon/${size}.png`]),
)
/** How much of the icon shows while no vault is paired or unlocked. */
const LOCKED_OPACITY = 0.4
const BADGE_COLOR = "#404040"
/** Tab events come in bursts, such as an activation followed by a load. */
const REFRESH_DELAY_MS = 150

let lockedIcon: Promise<Record<number, ImageData>> | null = null

/** The toolbar icon faded, drawn once from the packaged icon files. */
function fadedIcon(): Promise<Record<number, ImageData>> {
  lockedIcon ??= Promise.all(
    ICON_SIZES.map(async (size) => {
      const bitmap = await createImageBitmap(
        await (await fetch(`/icon/${size}.png`)).blob(),
      )
      const canvas = new OffscreenCanvas(size, size)
      const context = canvas.getContext("2d")
      if (!context) throw new Error("No 2D context")
      context.globalAlpha = LOCKED_OPACITY
      context.drawImage(bitmap, 0, 0, size, size)
      return [size, context.getImageData(0, 0, size, size)] as const
    }),
  ).then(Object.fromEntries)
  lockedIcon.catch(() => {
    lockedIcon = null
  })
  return lockedIcon
}

/**
 * Keeps the toolbar button current: faded while no vault is paired or unlocked, and the active
 * tab's number of logins on its badge. Returns a function that asks for a refresh, for changes the
 * tab events do not cover, such as an unlock.
 */
export function watchToolbar(
  providers: Providers,
  /** Told the active tab and its page's logins after each refresh. */
  onLogins?: (
    vaults: VaultView[],
    tab: Browser.tabs.Tab | undefined,
  ) => unknown,
): () => void {
  void browser.action.setBadgeBackgroundColor({ color: BADGE_COLOR })
  void browser.action.setBadgeTextColor?.({ color: "#ffffff" })

  let timer: ReturnType<typeof setTimeout> | undefined
  let ready: boolean | null = null
  /** Counts refreshes; one that finishes after a later one started is dropped. */
  let refreshes = 0
  const update = async () => {
    const refreshId = ++refreshes
    const tab = await activeTab()
    const vaults = await providers.loginsForPage(webPage(tab?.url), {
      passive: true,
    })
    if (refreshId !== refreshes) return
    void Promise.resolve(onLogins?.(vaults, tab)).catch(() => {})
    const anyReady = vaults.some((vault) => vault.status === "ready")
    if (anyReady !== ready) {
      ready = anyReady
      await browser.action.setIcon(
        anyReady ? { path: READY_ICON } : { imageData: await fadedIcon() },
      )
    }
    if (tab?.id === undefined) return
    const count = vaults.reduce((sum, vault) => sum + vault.logins.length, 0)
    await browser.action.setBadgeText({
      tabId: tab.id,
      text: count ? String(count) : "",
    })
  }
  const refresh = () => {
    clearTimeout(timer)
    timer = setTimeout(() => void update().catch(() => {}), REFRESH_DELAY_MS)
  }

  browser.tabs.onActivated.addListener(refresh)
  browser.tabs.onUpdated.addListener((_tabId, change, tab) => {
    if (tab.active && (change.url || change.status === "complete")) refresh()
  })
  browser.windows.onFocusChanged.addListener(refresh)
  refresh()
  return refresh
}

import { generatePassword, getGeneratorOptions } from "@/lib/generator"
import { type Language, resolveLanguage } from "@/lib/i18n/language"
import { getSettings } from "@/lib/settings"
import type { VaultView } from "./api"
import { fillLogin } from "./autofill"
import { copyText } from "./clipboard"
import { addHistory } from "./history"
import { webPage } from "./page"
import type { Providers } from "./providers"

type Action = "fill" | "copyUsername" | "copyPassword" | "copyCode"

const ACTIONS: readonly Action[] = [
  "fill",
  "copyUsername",
  "copyPassword",
  "copyCode",
]
const GENERATE_ID = "loginMenus.generate"
/**
 * The logins the submenus list and the page they were listed for. Kept in storage.session rather
 * than in memory: the menus outlive the service worker, and a click can start a new one.
 */
const LISTING_KEY = "loginMenus.listing"
/** Web pages only; "all" would also fill the toolbar button's own menu. */
const CONTEXTS: Browser.contextMenus.CreateProperties["contexts"] = [
  "page",
  "frame",
  "editable",
  "selection",
  "link",
  "image",
]

/** The menus' texts; kept here so the background does not carry the whole catalog. */
const TITLES: Record<Language, Record<Action | "generate", string>> = {
  "zh-CN": {
    fill: "填充登录",
    copyUsername: "复制用户名",
    copyPassword: "复制密码",
    copyCode: "复制验证码",
    generate: "生成密码并复制",
  },
  en: {
    fill: "Fill Login",
    copyUsername: "Copy Username",
    copyPassword: "Copy Password",
    copyCode: "Copy Verification Code",
    generate: "Generate Password and Copy",
  },
}

/** A submenu lists at most this many logins; a site rarely has more. */
const MAX_LOGINS = 20

interface Entry {
  vaultId: string
  loginId: string
  username: string
  label: string
  hasCode: boolean
}

interface Listing {
  /**
   * Different for each rendering and part of its menu IDs, so a click on a menu that was opened
   * before the logins changed matches nothing rather than whichever login took its place.
   */
  renderId: string
  tabId: number
  /** The origin of the page the logins were listed for. */
  origin: string
  entries: Entry[]
}

/** The tab the logins are listed for; only what identifies its page. */
type ListedTab = Pick<Browser.tabs.Tab, "id" | "url">

const ITEM_ID = /^loginMenus\.(\w+)\.([\da-f]+)\.(\d+)$/

function itemId(action: Action, renderId: string, index: number): string {
  return `loginMenus.${action}.${renderId}.${index}`
}

/**
 * The browser's context menu for the active page: submenus that fill a login or copy its username,
 * password or verification code, and an entry that generates a password and copies it. The login
 * submenus follow the active page's logins, which the toolbar recomputes as tabs change.
 */
export class LoginMenus {
  /** The last change of the menus; each waits for the one before, so no ID is made twice. */
  private changing: Promise<void> = Promise.resolve()

  constructor(private readonly providers: Providers) {
    browser.contextMenus.onClicked.addListener((info, tab) => {
      if (typeof info.menuItemId !== "string" || tab?.id === undefined) return
      void this.clicked(
        info.menuItemId,
        tab.id,
        info.frameId ?? 0,
        tab.url,
      ).catch(() => {})
    })
  }

  /** Lists the logins of the active tab's page in the submenus, or leaves them out when it has none. */
  show(vaults: VaultView[], tab: ListedTab | undefined): Promise<void> {
    this.changing = this.changing
      .then(() => render(vaults, tab))
      .catch(() => {})
    return this.changing
  }

  private async clicked(
    menuItemId: string,
    tabId: number,
    frameId: number,
    tabUrl: string | undefined,
  ): Promise<void> {
    if (menuItemId === GENERATE_ID) {
      const password = generatePassword(await getGeneratorOptions())
      await copyText(password, true)
      await addHistory(password, webPage(tabUrl)?.hostname ?? null)
      return
    }
    const match = ITEM_ID.exec(menuItemId)
    const action = match?.[1] as Action | undefined
    if (!match || !action || !ACTIONS.includes(action)) return
    const listing = (await browser.storage.session.get(LISTING_KEY))[
      LISTING_KEY
    ] as Listing | undefined
    const page = webPage(tabUrl)
    // The menus are shared by every tab and window; they only act on the page they were listed for.
    if (
      !listing ||
      listing.renderId !== match[2] ||
      listing.tabId !== tabId ||
      page?.origin !== listing.origin
    )
      return
    const entry = listing.entries[Number(match[3])]
    if (!entry) return
    const { vaultId, loginId } = entry
    const provider = this.providers.providerOf(vaultId)
    const tab = { tabId, frameId }
    switch (action) {
      case "fill":
        // The fill checks that the right-clicked frame's page is one the login is for.
        await fillLogin(this.providers, tabId, frameId, vaultId, loginId)
        return
      case "copyUsername":
        await copyText(entry.username, false)
        return
      case "copyPassword": {
        const credential = await provider.credential(
          vaultId,
          loginId,
          page,
          tab,
        )
        await copyText(credential.password, true)
        return
      }
      case "copyCode": {
        const { code } = await provider.oneTimeCode(vaultId, loginId, page, tab)
        await copyText(code, true)
        return
      }
    }
  }
}

async function render(
  vaults: VaultView[],
  tab: ListedTab | undefined,
): Promise<void> {
  const settings = await getSettings()
  const titles = TITLES[resolveLanguage(settings.language)]
  const page = webPage(tab?.url)
  const tabId = tab?.id
  const listing = settings.contextMenu && page !== null && tabId !== undefined
  const ready = vaults.filter(
    (vault) => vault.status === "ready" && !vault.error && vault.logins.length,
  )
  const entries: Entry[] = listing
    ? ready
        .flatMap((vault) =>
          vault.logins.map((login) => {
            const name = login.username || login.title
            return {
              vaultId: vault.id,
              loginId: login.id,
              username: login.username,
              label: ready.length > 1 ? `${name} · ${vault.label}` : name,
              hasCode: login.hasCode === true,
            }
          }),
        )
        .slice(0, MAX_LOGINS)
    : []
  const renderId = crypto.randomUUID().slice(0, 8)

  await removeOwn()
  if (listing && entries.length) {
    const stored: Listing = { renderId, tabId, origin: page.origin, entries }
    await browser.storage.session.set({ [LISTING_KEY]: stored })
  } else {
    await browser.storage.session.remove(LISTING_KEY)
  }
  if (!settings.contextMenu) return
  for (const action of ACTIONS) {
    const shown = entries
      .map((entry, index) => ({ entry, index }))
      .filter(
        ({ entry }) =>
          (action !== "copyUsername" || entry.username) &&
          (action !== "copyCode" || entry.hasCode),
      )
    if (!shown.length) continue
    await create({
      id: `loginMenus.${action}`,
      title: titles[action],
      contexts: CONTEXTS,
    })
    for (const { entry, index } of shown)
      await create({
        id: itemId(action, renderId, index),
        parentId: `loginMenus.${action}`,
        title: entry.label,
        contexts: CONTEXTS,
      })
  }
  await create({ id: GENERATE_ID, title: titles.generate, contexts: CONTEXTS })
}

function create(
  properties: Browser.contextMenus.CreateProperties,
): Promise<void> {
  return new Promise((resolve) => {
    browser.contextMenus.create(properties, () => {
      // Reading the error marks it as handled; a menu that could not be made is left out.
      void browser.runtime.lastError
      resolve()
    })
  })
}

/** Takes away the menus made here, which removes their submenus too; the extension's others stay. */
async function removeOwn(): Promise<void> {
  const ids = [GENERATE_ID, ...ACTIONS.map((action) => `loginMenus.${action}`)]
  await Promise.all(
    ids.map((id) => browser.contextMenus.remove(id).catch(() => {})),
  )
}

import { storage } from "wxt/utils/storage"
import { generatePassword, getGeneratorOptions } from "@/lib/generator"
import { type Language, resolveLanguage } from "@/lib/i18n/language"
import type { ProviderKind, TabRef } from "@/lib/providers/types"
import { serialQueue } from "@/lib/serial-queue"
import { getSettings } from "@/lib/settings"
import type { VaultView } from "./api"
import { fillLogin, fillNewPassword } from "./autofill"
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
const GENERATE_FILL_ID = "loginMenus.generateFill"
/**
 * The IDs of the top-level menus the last rendering made; removing them removes their submenus.
 * Kept in storage.local, which a browser restart does not clear, so menus Chrome keeps from an
 * earlier session can still be found and removed. They hold no logins.
 */
const madeMenusItem = storage.defineItem<string[]>(
  "local:loginMenus.topLevel",
  {
    fallback: [],
  },
)
/**
 * The logins the submenus list and the page they were listed for. Kept in storage.session rather
 * than in memory: the menus outlive the service worker, and a click can start a new one.
 */
const listingItem = storage.defineItem<Listing>("session:loginMenus.listing")
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
const TITLES: Record<
  Language,
  Record<Action | "generate" | "generateFill", string>
> = {
  "zh-CN": {
    fill: "填充登录",
    copyUsername: "复制用户名",
    copyPassword: "复制密码",
    copyCode: "复制验证码",
    generate: "生成密码并复制",
    generateFill: "生成密码并填充",
  },
  en: {
    fill: "Fill Login",
    copyUsername: "Copy Username",
    copyPassword: "Copy Password",
    copyCode: "Copy Verification Code",
    generate: "Generate Password and Copy",
    generateFill: "Generate Password and Fill",
  },
}

/** The menu lists at most this many logins; a site rarely has more. */
const MAX_LOGINS = 20

interface Entry {
  vaultId: string
  loginId: string
  username: string
  /** The login's line in the menu: its username, or its name without one. */
  name: string
  hasCode: boolean
}

/** A vault's heading over its logins, named as the interface names it. */
const VAULT_TITLES: Record<ProviderKind, (vault: VaultView) => string> = {
  apple: () => "Passwords",
  bitwarden: (vault) => `Bitwarden · ${vault.label}`,
}

/** What a login's submenu offers: copying a username or a code only when it has one. */
function actionsOf(entry: Entry): Action[] {
  return ACTIONS.filter(
    (action) =>
      (action !== "copyUsername" || entry.username) &&
      (action !== "copyCode" || entry.hasCode),
  )
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

function isAction(value: string | undefined): value is Action {
  return (ACTIONS as readonly (string | undefined)[]).includes(value)
}

/** A generated password, copied as a secret and kept in the generator's history. */
async function copyGenerated(
  password: string,
  tabUrl: string | undefined,
): Promise<void> {
  await copyText(password, true)
  await addHistory(password, webPage(tabUrl)?.hostname ?? null)
}

/**
 * The browser's context menu for the active page: the page's logins under a heading for each vault,
 * each with a submenu that fills it or copies its username, password or verification code, and
 * entries that generate a password and fill it into the right-clicked field or copy it. The logins
 * follow the active page, which the toolbar recomputes as tabs change.
 */
export class LoginMenus {
  /** Changes of the menus run one after another, so no ID is made twice. */
  private readonly changes = serialQueue()

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
    return this.changes(() => render(vaults, tab).catch(() => {}))
  }

  private async clicked(
    menuItemId: string,
    tabId: number,
    frameId: number,
    tabUrl: string | undefined,
  ): Promise<void> {
    if (menuItemId === GENERATE_FILL_ID || menuItemId === GENERATE_ID) {
      const password = generatePassword(await getGeneratorOptions())
      const filled =
        menuItemId === GENERATE_FILL_ID &&
        (await fillNewPassword(tabId, frameId, password).catch(() => false))
      // Without a field to take it, or where filling is turned off, the password is copied instead,
      // so choosing the entry is never lost.
      if (!filled) await copyGenerated(password, tabUrl)
      return
    }
    const page = webPage(tabUrl)
    const chosen = await listedChoice(menuItemId, tabId, page)
    if (chosen)
      await this.runLoginAction(chosen.action, chosen.entry, page, {
        tabId,
        frameId,
      })
  }

  private async runLoginAction(
    action: Action,
    entry: Entry,
    page: URL | null,
    tab: TabRef,
  ): Promise<void> {
    const { vaultId, loginId } = entry
    const provider = this.providers.providerOf(vaultId)
    switch (action) {
      case "fill":
        // The fill checks that the right-clicked frame's page is one the login is for.
        await fillLogin(
          this.providers,
          tab.tabId,
          tab.frameId,
          vaultId,
          loginId,
        )
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

/** The login and action of a clicked submenu item, when its listing is for the tab's page. */
async function listedChoice(
  menuItemId: string,
  tabId: number,
  page: URL | null,
): Promise<{ action: Action; entry: Entry } | null> {
  const match = ITEM_ID.exec(menuItemId)
  const action = match?.[1]
  if (!match || !isAction(action)) return null
  const listing = await listingItem.getValue()
  // The menus are shared by every tab and window; they only act on the page they were listed for.
  if (
    !listing ||
    listing.renderId !== match[2] ||
    listing.tabId !== tabId ||
    page?.origin !== listing.origin
  )
    return null
  const entry = listing.entries[Number(match[3])]
  return entry ? { action, entry } : null
}

/** The first logins of the ready vaults, as the submenus list them. */
function entriesOf(readyVaults: VaultView[]): Entry[] {
  return readyVaults
    .flatMap((vault) =>
      vault.logins.map((login) => ({
        vaultId: vault.id,
        loginId: login.id,
        username: login.username,
        name: login.username || login.title,
        hasCode: login.hasCode === true,
      })),
    )
    .slice(0, MAX_LOGINS)
}

async function render(
  vaults: VaultView[],
  tab: ListedTab | undefined,
): Promise<void> {
  const settings = await getSettings()
  const page = webPage(tab?.url)
  const tabId = tab?.id
  const listing = settings.contextMenu && page !== null && tabId !== undefined
  const ready = vaults.filter(
    (vault) => vault.status === "ready" && !vault.error && vault.logins.length,
  )
  const entries = listing ? entriesOf(ready) : []
  const renderId = crypto.randomUUID().slice(0, 8)

  await removeOwn()
  if (listing && entries.length) {
    await listingItem.setValue({
      renderId,
      tabId,
      origin: page.origin,
      entries,
    })
  } else {
    await listingItem.removeValue()
  }
  if (!settings.contextMenu) return
  const listed = ready.filter((vault) =>
    entries.some((entry) => entry.vaultId === vault.id),
  )
  await createMenus(
    listed,
    entries,
    renderId,
    TITLES[resolveLanguage(settings.language)],
  )
}

/** Makes the menus: each listed vault's heading and logins, then the generator's entries. */
async function createMenus(
  listed: VaultView[],
  entries: Entry[],
  renderId: string,
  titles: (typeof TITLES)[Language],
): Promise<void> {
  const made: string[] = []
  const add = async (
    properties: Browser.contextMenus.CreateProperties & { id: string },
  ) => {
    await create({ contexts: CONTEXTS, ...properties })
    if (properties.parentId === undefined) made.push(properties.id)
  }
  for (const [vaultIndex, vault] of listed.entries()) {
    if (vaultIndex > 0)
      await add({
        id: `loginMenus.${renderId}.separator.${vaultIndex}`,
        type: "separator",
      })
    await add({
      id: `loginMenus.${renderId}.vault.${vaultIndex}`,
      title: VAULT_TITLES[vault.kind](vault),
      enabled: false,
    })
    for (const [index, entry] of entries.entries()) {
      if (entry.vaultId !== vault.id) continue
      const loginMenuId = `loginMenus.${renderId}.login.${index}`
      await add({ id: loginMenuId, title: entry.name })
      for (const action of actionsOf(entry))
        await add({
          id: itemId(action, renderId, index),
          parentId: loginMenuId,
          title: titles[action],
        })
    }
  }
  if (listed.length)
    await add({ id: `loginMenus.${renderId}.separator.end`, type: "separator" })
  await add({
    id: GENERATE_FILL_ID,
    title: titles.generateFill,
    contexts: ["editable"],
  })
  await add({ id: GENERATE_ID, title: titles.generate })
  await madeMenusItem.setValue(made)
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
  const made = await madeMenusItem.getValue()
  await Promise.all(
    [...new Set([GENERATE_ID, GENERATE_FILL_ID, ...made])].map((id) =>
      browser.contextMenus.remove(id).catch(() => {}),
    ),
  )
  await madeMenusItem.removeValue()
}

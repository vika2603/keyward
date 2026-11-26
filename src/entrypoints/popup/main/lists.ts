import type { VaultView } from "@/background/api"
import type { ProviderKind } from "@/lib/providers/types"

/** The main list's provider tab: every vault, or one provider's. */
export type ProviderTab = "all" | ProviderKind

/** The vaults the main list shows, and how, from the popup's state and the user's choices. */
export interface MainLists {
  anyVaultReady: boolean
  /** What is searched; empty for the page's logins, and until a vault is ready to search. */
  search: string
  /** Whether the provider tabs show: once a vault is ready and there are vaults of both kinds. */
  tabsShown: boolean
  /** The tab that applies; every vault while the tabs are hidden. */
  activeTab: ProviderTab
  /** The vaults of the tab: the page's, or the search results. */
  shown: VaultView[]
  /** Whether the vaults in view can say a site has no logins, or take a new one. */
  shownReady: boolean
  /** Whether the tab lists whole vaults beside the site's logins. */
  browsing: boolean
  /** Vaults that get a large button to pair, unlock or set up. */
  locked: VaultView[]
  /** Vaults that list their logins, or say why they cannot. */
  listed: VaultView[]
  /** Every ready vault of the tab, as listed whole: what the group filter picks from. */
  filterable: VaultView[]
  /** The site's items in ready vaults. */
  siteItemCount: number
  /** Whether to say that Apple's helper cannot search for the text. */
  appleSearchHint: boolean
}

export function mainLists({
  vaults,
  results,
  allItems,
  query,
  tab,
}: {
  /** The page's vaults. */
  vaults: readonly VaultView[]
  /** The search results; null while they load. */
  results: readonly VaultView[] | null
  /** Every item of the vaults that can list themselves whole; null while they load. */
  allItems: readonly VaultView[] | null
  /** What is typed in the search box. */
  query: string
  /** The tab the user chose. */
  tab: ProviderTab
}): MainLists {
  const kinds = new Set(vaults.map((vault) => vault.kind))
  const anyVaultReady = vaults.some((vault) => vault.status === "ready")
  // Nothing can be searched or filtered until a vault is ready; the view offers to connect instead.
  const search = anyVaultReady ? query.trim() : ""
  const tabsShown = anyVaultReady && kinds.size > 1
  // Locking hides the tabs, and with them the choice of one; the choice comes back with them.
  const activeTab = tabsShown ? tab : "all"
  const inTab = (vault: VaultView) =>
    activeTab === "all" || vault.kind === activeTab
  const shown = (search ? (results ?? []) : vaults).filter(inTab)
  const shownReady = shown.some((vault) => vault.status === "ready")
  // With one provider in view and nothing searched, a provider that can list a whole vault offers
  // it beside the site's logins. Passwords cannot, so its view stays as it is.
  const oneProvider = activeTab !== "all" || kinds.size === 1
  // Locked vaults have nothing to browse; their unlock cards show instead.
  const browsing = anyVaultReady && !search && oneProvider && shownReady
  // Vaults to pair or unlock get a large button each, except on the "all" tab once one is open:
  // each is then unlocked from its own tab. The others list their logins or say why they cannot.
  const locked =
    activeTab === "all" && tabsShown ? [] : shown.filter(waitsForUser)
  const listed = shown.filter(
    (vault) =>
      !waitsForUser(vault) &&
      (vault.status !== "ready" ||
        vault.error ||
        vault.logins.length ||
        vault.notes?.length),
  )
  const filterable = (allItems ?? []).filter(
    (vault) => inTab(vault) && vault.status === "ready" && !vault.error,
  )
  const siteItemCount = listed.reduce(
    (count, vault) =>
      vault.status === "ready" && !vault.error
        ? count + vault.logins.length + (vault.notes?.length ?? 0)
        : count,
    0,
  )
  // Apple's helper looks logins up by site only, so a search for other text cannot reach it.
  const appleSearchHint =
    search !== "" &&
    !search.includes(".") &&
    shown.some((vault) => vault.kind === "apple" && vault.status === "ready")
  return {
    anyVaultReady,
    search,
    tabsShown,
    activeTab,
    shown,
    shownReady,
    browsing,
    locked,
    listed,
    filterable,
    siteItemCount,
    appleSearchHint,
  }
}

/** A vault that opens only once the user pairs it, unlocks it or sets it up. */
function waitsForUser(vault: VaultView): boolean {
  return vault.status === "locked" || Boolean(vault.needsSetup)
}

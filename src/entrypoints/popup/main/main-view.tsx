import { useLayoutEffect, useRef } from "react"
import { callBackground } from "@/background/api"
import { BrandIcon, providerName } from "@/components/keyward/brand-icon"
import { notifyError } from "@/components/keyward/notify"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { t } from "@/lib/i18n"
import type { Settings } from "@/lib/settings"
import type { View } from "../App"
import { ListArea } from "./list-area"
import { type ListPlace, usePlaceState } from "./list-place"
import type { ProviderTab } from "./lists"
import { MainHeader } from "./main-header"
import { SearchBar } from "./search-bar"
import { useMainLists } from "./use-main-lists"

/** The page's logins, or the search results, under the search box and the provider tabs. */
export function MainView({
  density,
  query,
  onQuery,
  place,
  onNavigate,
}: {
  density: Settings["density"]
  /** Searches the whole vault while not empty; the page's logins show otherwise. */
  query: string
  onQuery: (query: string) => void
  place: ListPlace
  onNavigate: (view: View) => void
}) {
  const [tab, changeTab] = usePlaceState(place, "tab")
  const [itemFilter, chooseItemFilter] = usePlaceState(place, "itemFilter")
  const [foldedSiteVaults, setFoldedSiteVaults] = usePlaceState(
    place,
    "foldedSiteVaults",
  )
  const [groupFilters, changeGroupFilters] = usePlaceState(
    place,
    "groupFilters",
  )
  const lists = useMainLists({ query, tab, groupFilters })
  const { loading, anyVaultReady, listReady } = lists

  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  /** The rows' buttons that open a login, in list order; arrow keys move between them. */
  const rowButtons = () => [
    ...(listRef.current?.querySelectorAll<HTMLButtonElement>("[data-row]") ??
      []),
  ]

  const foldSiteVault = (vaultId: string, open: boolean) => {
    const next = new Set(foldedSiteVaults)
    if (open) next.delete(vaultId)
    else next.add(vaultId)
    setFoldedSiteVaults(next)
  }
  const lockAll = async () => {
    try {
      await callBackground("popup.lockAll", null)
    } catch (error) {
      notifyError(error)
    }
    lists.load()
  }

  // Once the list is drawn the first time, it scrolls back to where it was left.
  const scrollRestored = useRef(false)
  useLayoutEffect(() => {
    if (!listReady || scrollRestored.current) return
    scrollRestored.current = true
    if (listRef.current) listRef.current.scrollTop = place.scrollTop
  }, [listReady, place])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MainHeader
        lockShown={loading || lists.vaults.length > 0}
        lockEnabled={anyVaultReady}
        onAdd={() => onNavigate({ name: "add" })}
        onGenerator={() => onNavigate({ name: "generator" })}
        onLockAll={() => void lockAll()}
      />
      {(loading || anyVaultReady) && (
        <SearchBar
          query={query}
          onQuery={onQuery}
          inputRef={searchRef}
          onFocusFirstRow={() => rowButtons()[0]?.focus()}
          onOpenFirstRow={() => rowButtons()[0]?.click()}
        />
      )}
      {lists.tabsShown && (
        <div className="px-2 pb-2">
          <Tabs
            value={tab}
            onValueChange={(value) => changeTab(value as ProviderTab)}
          >
            <TabsList className="w-full">
              <TabsTrigger value="all">{t("popup.main.all")}</TabsTrigger>
              {(["apple", "bitwarden"] as const).map((kind) => (
                <TabsTrigger key={kind} value={kind}>
                  <BrandIcon kind={kind} />
                  {providerName(kind)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      )}
      {(loading || anyVaultReady) && <Separator />}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: arrow keys move between the rows' buttons, which take the focus. */}
      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto pb-1"
        onScroll={(event) => {
          place.scrollTop = event.currentTarget.scrollTop
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
          const buttons = rowButtons()
          const index = buttons.indexOf(event.target as HTMLButtonElement)
          if (index < 0) return
          event.preventDefault()
          const next = index + (event.key === "ArrowDown" ? 1 : -1)
          if (next < 0) searchRef.current?.focus()
          else buttons[Math.min(next, buttons.length - 1)]?.focus()
        }}
      >
        <ListArea
          lists={lists}
          density={density}
          scrollElement={listRef}
          foldedSiteVaults={foldedSiteVaults}
          onFoldSiteVault={foldSiteVault}
          itemFilter={itemFilter}
          onChooseItemFilter={chooseItemFilter}
          groupFilters={groupFilters}
          onGroupFiltersChange={changeGroupFilters}
          onNavigate={onNavigate}
        />
      </div>
    </div>
  )
}

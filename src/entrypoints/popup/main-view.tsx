import {
  ChevronDownIcon,
  ExternalLinkIcon,
  ListFilterIcon,
  LockIcon,
  PlusIcon,
  RefreshCcwDotIcon,
  SearchIcon,
  XIcon,
} from "lucide-react"
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import keywardIcon from "@/assets/icon.svg"
import { callBackground, type PageInfo, type VaultView } from "@/background/api"
import {
  BrandIcon,
  providerName,
  vaultLabel,
} from "@/components/keyward/brand-icon"
import { isUnsupportedRequest } from "@/components/keyward/errors"
import { FADE_IN, LoginListSkeleton } from "@/components/keyward/loading"
import { notifyError } from "@/components/keyward/notify"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { t } from "@/lib/i18n"
import type {
  LoginSummary,
  NoteSummary,
  ProviderKind,
} from "@/lib/providers/types"
import type { Settings } from "@/lib/settings"
import { cn } from "@/lib/utils"
import type { View } from "./App"
import {
  ItemBrowser,
  type ItemFilter,
  rowsOfVault,
  VirtualRows,
} from "./all-items"
import { ConnectCard, LockedVaultCard } from "./connect-card"
import {
  canFilter,
  type GroupFilter,
  GroupFilterBar,
  isFiltering,
  NO_GROUP_FILTER,
  narrowed,
} from "./group-filter"
import { openOptions, SettingsButton } from "./header"

type Filter = "all" | ProviderKind

/**
 * Where the main list was left. The popup keeps one for as long as it is open and the main view
 * writes to it as the user moves, so coming back from an item finds the list as it was.
 */
export interface ListPlace {
  tab: Filter
  /** The list filter the user chose, or null while the site decides it. */
  itemFilter: ItemFilter | null
  /** Vaults whose logins for the site were folded. */
  foldedSiteVaults: ReadonlySet<string>
  groupFilter: GroupFilter
  /** Whether the pickers of the group filter are shown. */
  groupFilterShown: boolean
  scrollTop: number
}

export function newListPlace(): ListPlace {
  return {
    tab: "all",
    itemFilter: null,
    foldedSiteVaults: new Set(),
    groupFilter: NO_GROUP_FILTER,
    groupFilterShown: false,
    scrollTop: 0,
  }
}

/** A search waits for typing to pause this long. */
const SEARCH_DELAY_MS = 150

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
  const [state, setState] = useState<{
    page: PageInfo | null
    vaults: VaultView[]
  } | null>(null)
  const [results, setResults] = useState<VaultView[] | null>(null)
  /** Every item of the vaults that can list themselves whole, to browse instead of the site's logins. */
  const [everything, setEverything] = useState<VaultView[] | null>(null)
  /** Why the vaults could not be listed whole; shown only where the list would be. */
  const [everythingError, setEverythingError] = useState<unknown>(null)
  /** Changes after a lock, so the search runs again. */
  const [version, setVersion] = useState(0)
  const [filter, setFilter] = useState<Filter>(place.tab)
  const [itemFilter, setItemFilter] = useState(place.itemFilter)
  const [foldedSiteVaults, setFoldedSiteVaults] = useState(
    place.foldedSiteVaults,
  )
  const [groupFilter, setGroupFilter] = useState(place.groupFilter)
  const [groupFilterShown, setGroupFilterShown] = useState(
    place.groupFilterShown,
  )
  const changeGroupFilter = (next: GroupFilter) => {
    place.groupFilter = next
    setGroupFilter(next)
  }
  const showGroupFilter = (shown: boolean) => {
    place.groupFilterShown = shown
    setGroupFilterShown(shown)
    // Hiding the pickers drops what they chose, so nothing filters the list unseen.
    if (!shown) changeGroupFilter(NO_GROUP_FILTER)
  }
  const changeTab = (next: Filter) => {
    place.tab = next
    setFilter(next)
  }
  const chooseItemFilter = (next: ItemFilter) => {
    place.itemFilter = next
    setItemFilter(next)
  }
  const foldSiteVault = (vaultId: string, open: boolean) => {
    const next = new Set(foldedSiteVaults)
    if (open) next.delete(vaultId)
    else next.add(vaultId)
    place.foldedSiteVaults = next
    setFoldedSiteVaults(next)
  }
  /** A list request failed; its toast says why, and the list stops waiting for it. */
  const [failed, setFailed] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  /** The rows' buttons that open a login, in list order; arrow keys move between them. */
  const rows = () => [
    ...(listRef.current?.querySelectorAll<HTMLButtonElement>("[data-row]") ??
      []),
  ]

  const load = useCallback(() => {
    setFailed(false)
    callBackground("popup.state", null).then(setState, (error) => {
      setFailed(true)
      notifyError(error)
    })
    callBackground("popup.allItems", null).then(
      (found) => {
        setEverything(found)
        setEverythingError(null)
      },
      (error) => {
        setEverything([])
        setEverythingError(error)
      },
    )
    setVersion((v) => v + 1)
  }, [])
  useEffect(load, [load])

  // Nothing can be searched or filtered until a vault is ready; the view offers to connect instead.
  const connected =
    state?.vaults.some((vault) => vault.status === "ready") ?? false
  const search = connected ? query.trim() : ""
  useEffect(() => {
    setResults(null)
    if (!search || version < 1) return
    setFailed(false)
    let stale = false
    const timer = setTimeout(() => {
      callBackground("popup.search", { query: search }).then(
        (found) => !stale && setResults(found),
        (error) => {
          if (stale) return
          setFailed(true)
          notifyError(error)
        },
      )
    }, SEARCH_DELAY_MS)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [search, version])

  const loading = state === null
  const page = state?.page ?? null
  const vaults = state?.vaults ?? []
  const kinds = new Set(vaults.map((vault) => vault.kind))
  const anyReady = vaults.some((vault) => vault.status === "ready")
  const lockAll = async () => {
    try {
      await callBackground("popup.lockAll", null)
    } catch (error) {
      notifyError(error)
    }
    load()
  }
  const inTab = (vault: VaultView) => filter === "all" || vault.kind === filter
  // Every ready vault of the tab, as listed whole: what the group filter picks from.
  const filterable = (everything ?? []).filter(
    (vault) => inTab(vault) && vault.status === "ready" && !vault.error,
  )
  // A filter on an account that left the tab, or was locked, no longer applies.
  const activeFilter = filterable.some(
    (vault) => vault.id === groupFilter.vaultId,
  )
    ? groupFilter
    : NO_GROUP_FILTER
  const filtering = isFiltering(activeFilter)
  const shown = (search ? (results ?? []) : vaults)
    .filter(inTab)
    .map((vault) => narrowed(vault, activeFilter))
  const tabs = connected && kinds.size > 1
  // Vaults to pair or unlock get a large button each, except on the "all" tab once one is open:
  // each is then unlocked from its own tab. The others list their logins or say why they cannot.
  const locked =
    filter === "all" && tabs
      ? []
      : shown.filter((vault) => vault.status === "locked")
  // Whether the vaults in view can say a site has no logins, or take a new one.
  const shownReady = shown.some((vault) => vault.status === "ready")
  const listed = shown.filter(
    (vault) =>
      vault.status !== "locked" &&
      (vault.status !== "ready" ||
        vault.error ||
        vault.logins.length ||
        vault.notes?.length),
  )
  const lockedCards = locked.map((vault) => (
    <LockedVaultCard
      key={vault.id}
      vault={vault}
      onClick={() =>
        onNavigate({ name: "connect", kind: vault.kind, vaultId: vault.id })
      }
    />
  ))
  // With one provider in view and nothing searched, a provider that can list a whole vault offers
  // it beside the site's logins. Passwords cannot, so its view stays as it is.
  const oneProvider = filter !== "all" || kinds.size === 1
  // Locked vaults have nothing to browse; their unlock cards show instead.
  const browsing = connected && !search && oneProvider && shownReady
  const browsed = filterable
    .filter((vault) => !filtering || vault.id === activeFilter.vaultId)
    .map((vault) => narrowed(vault, activeFilter))
  const waitingForItems = browsing && everything === null
  const browsable = browsing && browsed.length > 0
  const siteItemCount = listed.reduce(
    (count, vault) =>
      vault.status === "ready" && !vault.error
        ? count + vault.logins.length + (vault.notes?.length ?? 0)
        : count,
    0,
  )
  // The whole vault is asked for on every opening; its failure matters only where it would show. A
  // background without the request leaves the site's logins, which need no message.
  useEffect(() => {
    if (browsing && everythingError && !isUnsupportedRequest(everythingError))
      notifyError(everythingError)
  }, [browsing, everythingError])
  const listReady = !(
    loading ||
    (search && results === null) ||
    waitingForItems
  )
  // Once the list is drawn the first time, it scrolls back to where it was left.
  const scrollRestored = useRef(false)
  useLayoutEffect(() => {
    if (!listReady || scrollRestored.current) return
    scrollRestored.current = true
    if (listRef.current) listRef.current.scrollTop = place.scrollTop
  }, [listReady, place])
  // Apple's helper looks logins up by site only, so a search for other text cannot reach it.
  const appleSearchHint =
    search !== "" &&
    !search.includes(".") &&
    shown.some((vault) => vault.kind === "apple" && vault.status === "ready")

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 py-2 pr-2 pl-3">
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">Keyward</h1>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("popup.add.title")}
          title={t("popup.add.title")}
          onClick={() => onNavigate({ name: "add" })}
        >
          <PlusIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("popup.generator.title")}
          title={t("popup.generator.title")}
          onClick={() => onNavigate({ name: "generator" })}
        >
          <RefreshCcwDotIcon />
        </Button>
        {/* Disabled rather than hidden once all is locked, so the buttons beside it stay put. */}
        {(loading || vaults.length > 0) && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("popup.main.lockAll")}
            title={t("popup.main.lockAll")}
            disabled={!anyReady}
            onClick={() => void lockAll()}
          >
            <LockIcon />
          </Button>
        )}
        <SettingsButton />
      </div>
      {(loading || connected) && (
        <div className="flex gap-1.5 px-2 pb-2">
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" />
            <Input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => onQuery(event.target.value)}
              onKeyDown={(event) => {
                // While an input method composes text, Enter, Escape and the arrows belong to it.
                if (event.nativeEvent.isComposing) return
                // Escape clears a search before it closes the popup.
                if (event.key === "Escape" && query) {
                  event.preventDefault()
                  onQuery("")
                } else if (event.key === "ArrowDown") {
                  event.preventDefault()
                  rows()[0]?.focus()
                } else if (event.key === "Enter") {
                  rows()[0]?.click()
                }
              }}
              placeholder={t("popup.main.search")}
              aria-label={t("popup.main.search")}
              autoComplete="off"
              spellCheck={false}
              autoFocus
              className="pr-8 pl-8 [&::-webkit-search-cancel-button]:appearance-none"
            />
            {query && (
              <Button
                variant="ghost"
                size="icon-xs"
                className="absolute top-1 right-1.5 text-muted-foreground"
                aria-label={t("popup.main.clearSearch")}
                title={t("popup.main.clearSearch")}
                onClick={() => {
                  onQuery("")
                  searchRef.current?.focus()
                }}
              >
                <XIcon />
              </Button>
            )}
          </div>
          {canFilter(filterable) && (
            <Button
              variant={groupFilterShown || filtering ? "secondary" : "ghost"}
              size="icon"
              aria-label={t("popup.main.filter.toggle")}
              title={t("popup.main.filter.toggle")}
              aria-pressed={groupFilterShown}
              onClick={() => showGroupFilter(!groupFilterShown)}
            >
              <ListFilterIcon />
            </Button>
          )}
        </div>
      )}
      {groupFilterShown && canFilter(filterable) && (
        <GroupFilterBar
          vaults={filterable}
          filter={activeFilter}
          onChange={changeGroupFilter}
        />
      )}
      {tabs && (
        <div className="px-2 pb-2">
          <Tabs
            value={filter}
            onValueChange={(value) => changeTab(value as Filter)}
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
      {(loading || connected) && <Separator />}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: arrow keys move between the rows' buttons, which take the focus. */}
      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto pb-1"
        onScroll={(event) => {
          place.scrollTop = event.currentTarget.scrollTop
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
          const list = rows()
          const index = list.indexOf(event.target as HTMLButtonElement)
          if (index < 0) return
          event.preventDefault()
          const next = index + (event.key === "ArrowDown" ? 1 : -1)
          if (next < 0) searchRef.current?.focus()
          else list[Math.min(next, list.length - 1)]?.focus()
        }}
      >
        {!listReady ? (
          !failed && <LoginListSkeleton compact={density === "compact"} />
        ) : !vaults.length ? (
          <EmptyState icon text={t("popup.main.noVault")}>
            <ConnectCard
              kind="apple"
              title={t("popup.main.pairApple")}
              detail={t("popup.main.pairAppleDetail")}
              onClick={() => onNavigate({ name: "connect", kind: "apple" })}
            />
            <ConnectCard
              kind="bitwarden"
              title={t("popup.main.signInBitwarden")}
              onClick={() => openOptions("onboard")}
            />
          </EmptyState>
        ) : browsable ? (
          <div className={FADE_IN}>
            {lockedCards.length > 0 && (
              <div className="flex flex-col gap-2 px-3 pt-3">{lockedCards}</div>
            )}
            <ItemBrowser
              vaults={browsed}
              host={page?.host ?? null}
              siteItemCount={siteItemCount}
              chosen={itemFilter}
              onChoose={chooseItemFilter}
              site={
                listed.length ? (
                  listed.map((vault) => (
                    <VaultGroup
                      key={vault.id}
                      vault={vault}
                      density={density}
                      scrollElement={listRef}
                      open={!foldedSiteVaults.has(vault.id)}
                      onOpenChange={(open) => foldSiteVault(vault.id, open)}
                      onLocked={load}
                      onOpen={(login) =>
                        onNavigate({ name: "detail", vault, login })
                      }
                      onOpenNote={(note) =>
                        onNavigate({ name: "note", vault, note })
                      }
                    />
                  ))
                ) : (
                  <p className="px-3 py-1.5 text-xs text-muted-foreground">
                    {t("popup.main.noLoginsHere")}
                  </p>
                )
              }
              density={density}
              scrollElement={listRef}
              onOpenLogin={(vault, login) =>
                onNavigate({ name: "detail", vault, login })
              }
              onOpenNote={(vault, note) =>
                onNavigate({ name: "note", vault, note })
              }
            />
          </div>
        ) : !listed.length ? (
          <EmptyState
            icon={!anyReady}
            text={
              search
                ? t("popup.main.noResults", { query: search })
                : !shownReady
                  ? t("popup.main.connectHint")
                  : page
                    ? t("popup.main.noLogins", { host: page.host })
                    : t("popup.main.notWebPage")
            }
          >
            {lockedCards}
            {appleSearchHint && (
              <p className="text-xs text-muted-foreground">
                {t("popup.main.appleSearchHint")}
              </p>
            )}
            {shownReady && !search && (
              <Button
                variant="outline"
                className="self-center"
                onClick={() => onNavigate({ name: "add" })}
              >
                <PlusIcon />
                {t("popup.add.title")}
              </Button>
            )}
          </EmptyState>
        ) : (
          <div className={FADE_IN}>
            {listed.map((vault) => (
              <VaultGroup
                key={vault.id}
                vault={vault}
                density={density}
                scrollElement={listRef}
                open={!foldedSiteVaults.has(vault.id)}
                onOpenChange={(open) => foldSiteVault(vault.id, open)}
                onLocked={load}
                onOpen={(login) => onNavigate({ name: "detail", vault, login })}
                onOpenNote={(note) => onNavigate({ name: "note", vault, note })}
              />
            ))}
            {appleSearchHint && (
              <p className="px-3 pt-2 pb-1 text-xs text-muted-foreground">
                {t("popup.main.appleSearchHint")}
              </p>
            )}
            {lockedCards.length > 0 && (
              <div className="flex flex-col gap-2 px-3 pt-3 pb-2">
                {lockedCards}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** A centred message in the list area, with the actions that follow from it below. */
function EmptyState({
  text,
  icon = false,
  children,
}: {
  text: string
  /** Shows Keyward's icon above, for the views before anything is connected. */
  icon?: boolean
  children?: ReactNode
}) {
  return (
    <div className="flex h-full flex-col items-stretch justify-center gap-4 px-4 pb-12 text-center">
      {icon && (
        <img
          src={keywardIcon}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="mb-1 size-14 self-center rounded-2xl"
        />
      )}
      <p className="text-sm text-muted-foreground">{text}</p>
      {children}
    </div>
  )
}

function VaultGroup({
  vault,
  density,
  scrollElement,
  open,
  onOpenChange,
  onLocked,
  onOpen,
  onOpenNote,
}: {
  vault: VaultView
  density: Settings["density"]
  /** The list area, which scrolls the group's rows. */
  scrollElement: RefObject<HTMLDivElement | null>
  open: boolean
  onOpenChange: (open: boolean) => void
  onLocked: () => void
  onOpen: (login: LoginSummary) => void
  onOpenNote: (note: NoteSummary) => void
}) {
  const rows = useMemo(() => rowsOfVault(vault), [vault])

  const lock = async () => {
    try {
      await callBackground("popup.lock", { vaultId: vault.id })
    } catch (error) {
      notifyError(error)
    }
    onLocked()
  }

  if (vault.status !== "ready" || vault.error) {
    return (
      <section>
        <h2 className="flex items-center gap-1.5 px-3 pt-1.5 pb-0.5 text-xs font-medium text-muted-foreground">
          <BrandIcon kind={vault.kind} className="size-3.5" />
          <span className="min-w-0 flex-1 truncate">{vaultLabel(vault)}</span>
          <span className="py-1.5" title={vault.error}>
            {vault.status === "ready"
              ? t("vault.failed")
              : t("vault.unavailable")}
          </span>
        </h2>
      </section>
    )
  }

  return (
    <Collapsible open={open} onOpenChange={onOpenChange} render={<section />}>
      {/* The chevron stays last and the lock, which every group has, next to it, so both line up
          across groups; the Apple group's extra button sits further left. */}
      <h2 className="flex items-center gap-0.5 pt-1.5 pr-1.5">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch px-3 text-left text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
          <BrandIcon kind={vault.kind} className="size-3.5" />
          <span className="min-w-0 truncate">{vaultLabel(vault)}</span>
        </CollapsibleTrigger>
        {vault.kind === "apple" && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            aria-label={t("popup.main.openPasswordsApp")}
            title={t("popup.main.openPasswordsApp")}
            onClick={() =>
              void callBackground("apple.openPasswordsApp", {}).catch(
                notifyError,
              )
            }
          >
            <ExternalLinkIcon />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground"
          aria-label={
            vault.kind === "apple"
              ? t("popup.main.lockApple")
              : t("popup.main.lock")
          }
          title={
            vault.kind === "apple"
              ? t("popup.main.lockApple")
              : t("popup.main.lock")
          }
          onClick={() => void lock()}
        >
          <LockIcon />
        </Button>
        {/* The label above is the keyboard's way to toggle; this is a second target for the pointer. */}
        {/* Not a ghost Button: that one keeps a grey fill while it is expanded. */}
        <CollapsibleTrigger
          tabIndex={-1}
          aria-label={t("popup.main.toggleGroup")}
          title={t("popup.main.toggleGroup")}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground [&_svg]:size-3"
        >
          <ChevronDownIcon
            className={cn("transition-transform", !open && "-rotate-90")}
          />
        </CollapsibleTrigger>
      </h2>
      <CollapsibleContent>
        <div className="pt-1">
          <VirtualRows
            rows={rows}
            density={density}
            scrollElement={scrollElement}
            onOpenLogin={(_, login) => onOpen(login)}
            onOpenNote={(_, note) => onOpenNote(note)}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

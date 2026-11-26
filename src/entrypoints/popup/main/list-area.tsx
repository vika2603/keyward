import { PlusIcon } from "lucide-react"
import { type ReactNode, type RefObject, useMemo } from "react"
import keywardIcon from "@/assets/icon.svg"
import type { VaultView } from "@/background/api"
import { FADE_IN, LoginListSkeleton } from "@/components/keyward/loading"
import { Button } from "@/components/ui/button"
import { t } from "@/lib/i18n"
import type { Settings } from "@/lib/settings"
import { ConnectCard, LockedVaultCard } from "../connect-card"
import { openConnectPage, openOptions } from "../header"
import type { View } from "../views"
import { ItemBrowser, type ItemFilter } from "./all-items"
import { type AccountFilters, GroupFilterContext } from "./group-filter"
import type { MainListsState } from "./use-main-lists"
import { VaultGroup } from "./vault-group"

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

/**
 * What the main list shows: a placeholder while it loads, ways to connect, whole vaults to browse,
 * the site's logins or search results, or why there are none.
 */
export function ListArea({
  lists,
  density,
  scrollElement,
  foldedSiteVaults,
  onFoldSiteVault,
  itemFilter,
  onChooseItemFilter,
  groupFilters,
  onGroupFiltersChange,
  onNavigate,
}: {
  lists: MainListsState
  density: Settings["density"]
  scrollElement: RefObject<HTMLDivElement | null>
  foldedSiteVaults: ReadonlySet<string>
  onFoldSiteVault: (vaultId: string, open: boolean) => void
  itemFilter: ItemFilter | null
  onChooseItemFilter: (filter: ItemFilter) => void
  groupFilters: AccountFilters
  onGroupFiltersChange: (filters: AccountFilters) => void
  onNavigate: (view: View) => void
}) {
  const { filterable } = lists
  const groupFilterContext = useMemo(
    () => ({
      filters: groupFilters,
      vaults: filterable,
      onChange: onGroupFiltersChange,
    }),
    [groupFilters, filterable, onGroupFiltersChange],
  )

  if (!lists.listReady)
    return lists.failed ? null : (
      <LoginListSkeleton compact={density === "compact"} />
    )

  if (!lists.vaults.length) {
    return (
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
    )
  }

  const { search, page } = lists
  const lockedCards = lists.locked.map((vault) => (
    <LockedVaultCard
      key={vault.id}
      vault={vault}
      onClick={() =>
        vault.needsSetup
          ? openConnectPage()
          : onNavigate({ name: "connect", kind: vault.kind, vaultId: vault.id })
      }
    />
  ))
  const vaultGroup = (vault: VaultView, heading: "vault" | "tab") => (
    <VaultGroup
      key={vault.id}
      vault={vault}
      heading={heading}
      title={
        heading === "tab" && !search && page
          ? t("popup.main.currentSite", { host: page.host })
          : undefined
      }
      density={density}
      scrollElement={scrollElement}
      open={!foldedSiteVaults.has(vault.id)}
      onOpenChange={(open) => onFoldSiteVault(vault.id, open)}
      onLocked={lists.load}
      onOpen={(login) => onNavigate({ name: "detail", vault, login })}
      onOpenNote={(note) => onNavigate({ name: "note", vault, note })}
    />
  )
  if (lists.browsable) {
    return (
      <div className={FADE_IN}>
        {lockedCards.length > 0 && (
          <div className="flex flex-col gap-2 px-3 pt-3">{lockedCards}</div>
        )}
        <GroupFilterContext value={groupFilterContext}>
          <ItemBrowser
            vaults={lists.browsed}
            host={page?.host ?? null}
            siteItemCount={lists.siteItemCount}
            chosen={itemFilter}
            onChoose={onChooseItemFilter}
            onChanged={lists.load}
            site={
              lists.listed.length ? (
                lists.listed.map((vault) => vaultGroup(vault, "vault"))
              ) : (
                <p className="px-3 py-1.5 text-xs text-muted-foreground">
                  {t("popup.main.noLoginsHere")}
                </p>
              )
            }
            density={density}
            scrollElement={scrollElement}
            onOpenLogin={(vault, login) =>
              onNavigate({ name: "detail", vault, login })
            }
            onOpenNote={(vault, note) =>
              onNavigate({ name: "note", vault, note })
            }
          />
        </GroupFilterContext>
      </div>
    )
  }

  if (!lists.listed.length) {
    let emptyMessage: string
    if (search) emptyMessage = t("popup.main.noResults", { query: search })
    else if (!lists.shownReady) emptyMessage = t("popup.main.connectHint")
    else if (page) emptyMessage = t("popup.main.noLogins", { host: page.host })
    else emptyMessage = t("popup.main.notWebPage")
    return (
      <EmptyState icon={!lists.anyVaultReady} text={emptyMessage}>
        {lockedCards}
        {lists.appleSearchHint && (
          <p className="text-xs text-muted-foreground">
            {t("popup.main.appleSearchHint")}
          </p>
        )}
        {lists.shownReady && !search && (
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
    )
  }

  return (
    <div className={FADE_IN}>
      {lists.listed.map((vault) =>
        vaultGroup(vault, lists.activeTab === "apple" ? "tab" : "vault"),
      )}
      {lists.appleSearchHint && (
        <p className="px-3 pt-2 pb-1 text-xs text-muted-foreground">
          {t("popup.main.appleSearchHint")}
        </p>
      )}
      {lockedCards.length > 0 && (
        <div className="flex flex-col gap-2 px-3 pt-3 pb-2">{lockedCards}</div>
      )}
    </div>
  )
}

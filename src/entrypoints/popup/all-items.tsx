import { useVirtualizer } from "@tanstack/react-virtual"
import { ChevronDownIcon } from "lucide-react"
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { VaultView } from "@/background/api"
import { BrandIcon, vaultLabel } from "@/components/keyward/brand-icon"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { currentLanguage, type MessageKey, t } from "@/lib/i18n"
import type { LoginSummary, NoteSummary } from "@/lib/providers/types"
import type { Settings } from "@/lib/settings"
import { cn } from "@/lib/utils"
import { LoginRow, NoteRow } from "./item-rows"

type ItemKind = "all" | "logins" | "notes"
/** What the list shows: the site's items, or every item of a kind. */
type ItemFilter = "site" | ItemKind

const KIND_LABELS: Record<ItemKind, MessageKey> = {
  all: "popup.main.itemKind.all",
  logins: "popup.main.itemKind.logins",
  notes: "popup.main.itemKind.notes",
}

type ItemRow =
  | { type: "login"; vault: VaultView; login: LoginSummary; name: string }
  | { type: "note"; vault: VaultView; note: NoteSummary; name: string }

export type Row =
  | ItemRow
  /** An account's heading when several are listed; its items follow it while it is open. */
  | { type: "vault"; vault: VaultView; count: number; open: boolean }

/**
 * The vaults whose part of the list of every item was last left folded, as a JSON list of vault
 * IDs. A view preference of the popup, kept in its own page storage so it is known before the
 * first draw.
 */
const FOLDED_VAULTS_KEY = "keyward.allItemsFoldedVaults"

function savedFoldedVaults(): ReadonlySet<string> {
  try {
    const saved: unknown = JSON.parse(
      localStorage.getItem(FOLDED_VAULTS_KEY) ?? "[]",
    )
    const ids = Array.isArray(saved) ? saved : []
    return new Set(ids.filter((id) => typeof id === "string"))
  } catch {
    return new Set()
  }
}

/** Estimated heights in pixels; each row is measured once it is drawn. */
const VAULT_ROW_HEIGHT = 28
const ITEM_ROW_HEIGHT = { standard: 50, compact: 38 }

/**
 * Each vault's items of the chosen kind, sorted by name, under the vault's name when there are
 * several; a folded vault shows only its name. The count is of every item, folded or not.
 */
function rowsOf(
  vaults: readonly VaultView[],
  kind: ItemKind,
  foldedVaults: ReadonlySet<string>,
): { rows: Row[]; itemCount: number } {
  const collator = new Intl.Collator(currentLanguage(), {
    numeric: true,
    sensitivity: "base",
  })
  const rows: Row[] = []
  let itemCount = 0
  for (const vault of vaults) {
    const logins: ItemRow[] =
      kind === "notes"
        ? []
        : vault.logins.map((login) => ({
            type: "login",
            vault,
            login,
            name: login.title || login.username,
          }))
    const notes: ItemRow[] =
      kind === "logins"
        ? []
        : (vault.notes ?? []).map((note) => ({
            type: "note",
            vault,
            note,
            name: note.name,
          }))
    const items = [...logins, ...notes].sort((first, second) =>
      collator.compare(first.name, second.name),
    )
    itemCount += items.length
    const open = vaults.length === 1 || !foldedVaults.has(vault.id)
    if (vaults.length > 1)
      rows.push({ type: "vault", vault, count: items.length, open })
    if (open) rows.push(...items)
  }
  return { rows, itemCount }
}

/** A vault's logins, then its notes, in the order the background listed them. */
export function rowsOfVault(vault: VaultView): Row[] {
  const logins: ItemRow[] = vault.logins.map((login) => ({
    type: "login",
    vault,
    login,
    name: login.title || login.username,
  }))
  const notes: ItemRow[] = (vault.notes ?? []).map((note) => ({
    type: "note",
    vault,
    note,
    name: note.name,
  }))
  return [...logins, ...notes]
}

function keyOf(row: Row): string {
  switch (row.type) {
    case "vault":
      return `vault:${row.vault.id}`
    case "login":
      return `login:${row.vault.id}:${row.login.id}`
    case "note":
      return `note:${row.vault.id}:${row.note.id}`
  }
}

/**
 * Rows of logins and notes in the popup's list area. Only the rows near the visible part are drawn,
 * so thousands of rows scroll as smoothly as a few. The rows scroll with the list area, below
 * whatever comes before them there.
 */
export function VirtualRows({
  rows,
  density,
  scrollElement,
  nameFirst = false,
  onToggleVault,
  onOpenLogin,
  onOpenNote,
}: {
  rows: readonly Row[]
  density: Settings["density"]
  /** The element that scrolls the rows. */
  scrollElement: RefObject<HTMLDivElement | null>
  /** Shows each login's name above its username, as in a list sorted by name. */
  nameFirst?: boolean
  /** Folds or unfolds an account's part of the rows, from its heading. */
  onToggleVault?: (vaultId: string) => void
  onOpenLogin: (vault: VaultView, login: LoginSummary) => void
  onOpenNote: (vault: VaultView, note: NoteSummary) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  /** How far the rows start below the top of the scrolled content. */
  const [scrollMargin, setScrollMargin] = useState(0)

  const measure = useCallback(() => {
    const list = listRef.current
    const scroller = scrollElement.current
    if (!list || !scroller) return
    const listTop = list.getBoundingClientRect().top
    const scrollerTop = scroller.getBoundingClientRect().top
    const margin = Math.round(listTop - scrollerTop + scroller.scrollTop)
    setScrollMargin((current) => (current === margin ? current : margin))
  }, [scrollElement])

  // Content before the rows moves them when it renders anew, as a message appears, or when it
  // changes size without rendering, as a group above folds. A change of size anywhere above
  // resizes one of the rows' ancestors.
  useLayoutEffect(measure)
  useLayoutEffect(() => {
    const scroller = scrollElement.current
    const observer = new ResizeObserver(measure)
    let ancestor = listRef.current?.parentElement ?? null
    while (ancestor && ancestor !== scroller) {
      observer.observe(ancestor)
      ancestor = ancestor.parentElement
    }
    return () => observer.disconnect()
  }, [measure, scrollElement])

  const itemHeight = ITEM_ROW_HEIGHT[density]
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollElement.current,
    estimateSize: (index) =>
      rows[index]?.type === "vault" ? VAULT_ROW_HEIGHT : itemHeight,
    getItemKey: (index) => {
      const row = rows[index]
      return row ? keyOf(row) : index
    },
    overscan: 10,
    scrollMargin,
  })

  return (
    <div
      ref={listRef}
      className="relative"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((item) => {
        const row = rows[item.index]
        if (!row) return null
        return (
          <div
            key={item.key}
            data-index={item.index}
            ref={virtualizer.measureElement}
            className="absolute top-0 left-0 w-full px-1 pb-0.5"
            style={{ transform: `translateY(${item.start - scrollMargin}px)` }}
          >
            {row.type === "vault" && (
              <button
                type="button"
                aria-expanded={row.open}
                onClick={() => onToggleVault?.(row.vault.id)}
                className="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <BrandIcon kind={row.vault.kind} className="size-3.5" />
                <span className="min-w-0 flex-1 truncate">
                  {vaultLabel(row.vault)}
                </span>
                <span className="tabular-nums">{row.count}</span>
                <ChevronDownIcon
                  className={cn(
                    "size-3 transition-transform",
                    !row.open && "-rotate-90",
                  )}
                />
              </button>
            )}
            {row.type === "login" && (
              <LoginRow
                vault={row.vault}
                login={row.login}
                density={density}
                nameFirst={nameFirst}
                onOpen={() => onOpenLogin(row.vault, row.login)}
              />
            )}
            {row.type === "note" && (
              <NoteRow
                vault={row.vault}
                note={row.note}
                density={density}
                onOpen={() => onOpenNote(row.vault, row.note)}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * The list under one provider that can list its vaults whole, while nothing is searched: the site's
 * items, or every item, every login or every note sorted by name, as the filter on top says.
 */
export function ItemBrowser({
  vaults,
  host,
  siteItemCount,
  site,
  density,
  scrollElement,
  onOpenLogin,
  onOpenNote,
}: {
  vaults: readonly VaultView[]
  /** The page's host; the filter offers the site's items only when there is one. */
  host: string | null
  siteItemCount: number
  /** The site's items, shown while the filter is on them. */
  site: ReactNode
  density: Settings["density"]
  scrollElement: RefObject<HTMLDivElement | null>
  onOpenLogin: (vault: VaultView, login: LoginSummary) => void
  onOpenNote: (vault: VaultView, note: NoteSummary) => void
}) {
  const hasNotes = vaults.some((vault) => vault.notes?.length)
  const filters: ItemFilter[] = [
    ...(host ? (["site"] as const) : []),
    "all",
    ...(hasNotes ? (["logins", "notes"] as const) : []),
  ]
  /** The user's choice; until there is one, the site's items if it has any, every item otherwise. */
  const [chosen, setChosen] = useState<ItemFilter | null>(null)
  const filter =
    chosen && filters.includes(chosen)
      ? chosen
      : host && siteItemCount > 0
        ? "site"
        : "all"
  const [foldedVaults, setFoldedVaults] = useState(savedFoldedVaults)
  const { rows, itemCount } = useMemo(
    () =>
      filter === "site"
        ? { rows: [], itemCount: siteItemCount }
        : rowsOf(vaults, filter, foldedVaults),
    [vaults, filter, foldedVaults, siteItemCount],
  )
  const toggleVault = (vaultId: string) => {
    const next = new Set(foldedVaults)
    if (next.has(vaultId)) next.delete(vaultId)
    else next.add(vaultId)
    setFoldedVaults(next)
    localStorage.setItem(FOLDED_VAULTS_KEY, JSON.stringify([...next]))
  }
  const labelOf = (value: ItemFilter) =>
    value === "site"
      ? t("popup.main.currentSite", { host: host ?? "" })
      : t(KIND_LABELS[value])

  return (
    <section>
      <div className="flex min-h-9 items-center gap-2 pt-2 pr-3 pl-2">
        {filters.length > 1 ? (
          <Select
            value={filter}
            onValueChange={(value) => setChosen(value as ItemFilter)}
            items={filters.map((value) => ({ value, label: labelOf(value) }))}
          >
            <SelectTrigger
              size="sm"
              className="min-w-0 text-xs"
              aria-label={t("popup.main.itemFilter")}
            >
              <SelectValue />
            </SelectTrigger>
            {/* As wide as the longest choice, which can be wider than the chosen one on the trigger. */}
            <SelectContent
              align="start"
              className="w-auto max-w-(--available-width)"
            >
              <SelectGroup>
                {filters.map((value) => (
                  <SelectItem key={value} value={value}>
                    {/* A long host would run past the popup's edge, as the item's text never shrinks. */}
                    <span className="max-w-64 truncate">{labelOf(value)}</span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : (
          <h2 className="truncate px-1 text-xs font-semibold">
            {t("popup.main.allItems")}
          </h2>
        )}
        <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
          {itemCount}
        </span>
      </div>
      {filter === "site" ? (
        site
      ) : itemCount === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          {t("popup.main.noItems")}
        </p>
      ) : (
        <VirtualRows
          rows={rows}
          density={density}
          scrollElement={scrollElement}
          nameFirst
          onToggleVault={toggleVault}
          onOpenLogin={onOpenLogin}
          onOpenNote={onOpenNote}
        />
      )}
    </section>
  )
}

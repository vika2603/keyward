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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Select,
  SelectContent,
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

const KIND_LABELS: Record<ItemKind, MessageKey> = {
  all: "popup.main.itemKind.all",
  logins: "popup.main.itemKind.logins",
  notes: "popup.main.itemKind.notes",
}
const KINDS = Object.keys(KIND_LABELS) as ItemKind[]

type ItemRow =
  | { type: "login"; vault: VaultView; login: LoginSummary; name: string }
  | { type: "note"; vault: VaultView; note: NoteSummary; name: string }

export type Row =
  | ItemRow
  /** An account's heading when several are listed; its items follow it while it is open. */
  | { type: "vault"; vault: VaultView; count: number; open: boolean }

/**
 * Whether the list of all items was last left folded. A view preference of the popup, kept in its
 * own page storage so it is known before the first draw.
 */
const ALL_ITEMS_FOLDED_KEY = "keyward.allItemsFolded"
/** The vaults whose part of the list was last left folded, as a JSON list of vault IDs. */
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

/** A heading of the main list's sections, with room for a control on its right. */
export function SectionHeading({
  children,
  action,
}: {
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex min-h-9 items-center gap-2 px-3 pt-2">
      <h2 className="min-w-0 flex-1 truncate text-xs font-semibold">
        {children}
      </h2>
      {action}
    </div>
  )
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

/** Every item of the vaults, sorted by name, with a choice of logins, notes or both. */
export function AllItems({
  vaults,
  density,
  scrollElement,
  onOpenLogin,
  onOpenNote,
}: {
  vaults: readonly VaultView[]
  density: Settings["density"]
  scrollElement: RefObject<HTMLDivElement | null>
  onOpenLogin: (vault: VaultView, login: LoginSummary) => void
  onOpenNote: (vault: VaultView, note: NoteSummary) => void
}) {
  const [kind, setKind] = useState<ItemKind>("all")
  const [foldedVaults, setFoldedVaults] = useState(savedFoldedVaults)
  const { rows, itemCount } = useMemo(
    () => rowsOf(vaults, kind, foldedVaults),
    [vaults, kind, foldedVaults],
  )
  const toggleVault = (vaultId: string) => {
    const next = new Set(foldedVaults)
    if (next.has(vaultId)) next.delete(vaultId)
    else next.add(vaultId)
    setFoldedVaults(next)
    localStorage.setItem(FOLDED_VAULTS_KEY, JSON.stringify([...next]))
  }
  const hasNotes = vaults.some((vault) => vault.notes?.length)
  const [open, setOpen] = useState(
    () => localStorage.getItem(ALL_ITEMS_FOLDED_KEY) !== "true",
  )
  const changeOpen = (next: boolean) => {
    setOpen(next)
    localStorage.setItem(ALL_ITEMS_FOLDED_KEY, String(!next))
  }

  return (
    <Collapsible open={open} onOpenChange={changeOpen} render={<section />}>
      <div className="flex min-h-9 items-center gap-1 pt-2 pr-1.5">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center self-stretch px-3 text-left text-xs font-semibold outline-none hover:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
          <span className="truncate">
            {t("popup.main.allItems")}
            <span className="font-normal text-muted-foreground">
              {` · ${itemCount}`}
            </span>
          </span>
        </CollapsibleTrigger>
        {open && hasNotes && (
          <Select
            value={kind}
            onValueChange={(value) => setKind(value as ItemKind)}
            items={KINDS.map((value) => ({
              value,
              label: t(KIND_LABELS[value]),
            }))}
          >
            <SelectTrigger
              size="sm"
              className="text-xs"
              aria-label={t("popup.main.itemKind")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {KINDS.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(KIND_LABELS[value])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {/* The title above is the keyboard's way to fold; this is a second target for the pointer. */}
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
      </div>
      <CollapsibleContent>
        {itemCount === 0 && (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            {t("popup.main.noItems")}
          </p>
        )}
        <VirtualRows
          rows={rows}
          density={density}
          scrollElement={scrollElement}
          nameFirst
          onToggleVault={toggleVault}
          onOpenLogin={onOpenLogin}
          onOpenNote={onOpenNote}
        />
      </CollapsibleContent>
    </Collapsible>
  )
}

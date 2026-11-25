import { useVirtualizer } from "@tanstack/react-virtual"
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { currentLanguage, type MessageKey, t } from "@/lib/i18n"
import type { LoginSummary, NoteSummary } from "@/lib/providers/types"
import type { Settings } from "@/lib/settings"
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

export type Row = ItemRow | { type: "vault"; vault: VaultView; count: number }

/** Estimated heights in pixels; each row is measured once it is drawn. */
const VAULT_ROW_HEIGHT = 28
const ITEM_ROW_HEIGHT = { standard: 50, compact: 38 }

/** Each vault's items of the chosen kind, sorted by name, under the vault's name when there are several. */
function rowsOf(vaults: readonly VaultView[], kind: ItemKind): Row[] {
  const collator = new Intl.Collator(currentLanguage(), {
    numeric: true,
    sensitivity: "base",
  })
  const rows: Row[] = []
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
    if (vaults.length > 1)
      rows.push({ type: "vault", vault, count: items.length })
    rows.push(...items)
  }
  return rows
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
  onOpenLogin,
  onOpenNote,
  onError,
}: {
  rows: readonly Row[]
  density: Settings["density"]
  /** The element that scrolls the rows. */
  scrollElement: RefObject<HTMLDivElement | null>
  /** Shows each login's name above its username, as in a list sorted by name. */
  nameFirst?: boolean
  onOpenLogin: (vault: VaultView, login: LoginSummary) => void
  onOpenNote: (vault: VaultView, note: NoteSummary) => void
  onError: (message: string | null) => void
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
              <div className="flex h-7 items-center gap-1.5 px-2 text-xs font-medium text-muted-foreground">
                <BrandIcon kind={row.vault.kind} className="size-3.5" />
                <span className="min-w-0 flex-1 truncate">
                  {vaultLabel(row.vault)}
                </span>
                <span className="tabular-nums">{row.count}</span>
              </div>
            )}
            {row.type === "login" && (
              <LoginRow
                vault={row.vault}
                login={row.login}
                density={density}
                nameFirst={nameFirst}
                onOpen={() => onOpenLogin(row.vault, row.login)}
                onError={onError}
              />
            )}
            {row.type === "note" && (
              <NoteRow
                vault={row.vault}
                note={row.note}
                density={density}
                onOpen={() => onOpenNote(row.vault, row.note)}
                onError={onError}
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
  onError,
}: {
  vaults: readonly VaultView[]
  density: Settings["density"]
  scrollElement: RefObject<HTMLDivElement | null>
  onOpenLogin: (vault: VaultView, login: LoginSummary) => void
  onOpenNote: (vault: VaultView, note: NoteSummary) => void
  onError: (message: string | null) => void
}) {
  const [kind, setKind] = useState<ItemKind>("all")
  const rows = useMemo(() => rowsOf(vaults, kind), [vaults, kind])
  const itemCount = rows.filter((row) => row.type !== "vault").length
  const hasNotes = vaults.some((vault) => vault.notes?.length)

  return (
    <section>
      <SectionHeading
        action={
          hasNotes && (
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
          )
        }
      >
        {t("popup.main.allItems")}
        <span className="font-normal text-muted-foreground">
          {` · ${itemCount}`}
        </span>
      </SectionHeading>
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
        onOpenLogin={onOpenLogin}
        onOpenNote={onOpenNote}
        onError={onError}
      />
    </section>
  )
}

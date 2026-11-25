import { ListFilterIcon } from "lucide-react"
import { createContext, useContext } from "react"
import type { VaultView } from "@/background/api"
import { compareNames } from "@/components/keyward/format"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Toggle } from "@/components/ui/toggle"
import { type MessageKey, t } from "@/lib/i18n"
import type { ItemGrouping } from "@/lib/providers/types"

/** The account's own vault, as an owner beside its organizations. */
const MY_VAULT = "mine"
/** Items in no folder, as a folder. */
const NO_FOLDER = "none"
const ALL = "all"

/**
 * A narrowing of one account's items to an owner, a folder and a collection, as Bitwarden's own
 * filters do; organizations, folders and collections are each account's own.
 */
export interface GroupFilter {
  /** MY_VAULT or an organization ID. */
  owner: string | null
  /** A folder ID or NO_FOLDER. */
  folder: string | null
  collection: string | null
}

export const NO_GROUP_FILTER: GroupFilter = {
  owner: null,
  folder: null,
  collection: null,
}

/** The group filters of the accounts in the list. */
export interface AccountFilters {
  /** Each account's choices, by vault ID; an account without any is not narrowed. */
  choices: Readonly<Record<string, GroupFilter>>
  /** The accounts whose pickers are shown. */
  shown: readonly string[]
}

export const NO_ACCOUNT_FILTERS: AccountFilters = { choices: {}, shown: [] }

type Part = keyof GroupFilter

function isFiltering(filter: GroupFilter | undefined): boolean {
  return Boolean(filter?.owner || filter?.folder || filter?.collection)
}

function fits(grouping: ItemGrouping | undefined, filter: GroupFilter) {
  if (!grouping) return false
  if (filter.owner === MY_VAULT && grouping.organizationId !== null)
    return false
  if (
    filter.owner &&
    filter.owner !== MY_VAULT &&
    grouping.organizationId !== filter.owner
  )
    return false
  if (filter.folder === NO_FOLDER && grouping.folderId !== null) return false
  if (
    filter.folder &&
    filter.folder !== NO_FOLDER &&
    grouping.folderId !== filter.folder
  )
    return false
  return (
    !filter.collection || grouping.collectionIds.includes(filter.collection)
  )
}

/** A vault with only the items its account's filter lets through. */
export function narrowed(
  vault: VaultView,
  filter: GroupFilter | undefined,
): VaultView {
  if (!filter || !isFiltering(filter)) return vault
  return {
    ...vault,
    logins: vault.logins.filter((login) => fits(login.grouping, filter)),
    notes: vault.notes?.filter((note) => fits(note.grouping, filter)),
    trashed: vault.trashed?.filter((item) => fits(item.grouping, filter)),
  }
}

/** Whether an account has anything to filter by. */
function canFilter(vault: VaultView | undefined): boolean {
  const groups = vault?.groups
  return Boolean(
    groups &&
      (groups.organizations.length > 0 ||
        groups.folders.length > 0 ||
        groups.collections.length > 0),
  )
}

interface GroupFilters {
  filters: AccountFilters
  /** The accounts as listed whole, before any filter: what the pickers choose from. */
  vaults: readonly VaultView[]
  onChange: (filters: AccountFilters) => void
}

/** The list's account filters, for the buttons and pickers placed with each account. */
export const GroupFilterContext = createContext<GroupFilters | null>(null)

interface Choice {
  value: string
  label: string
}

/** An account's choices for one part of the filter; none when the account has nothing there. */
function choicesOf(vault: VaultView, part: Part): Choice[] {
  const groups = vault.groups
  if (!groups) return []
  const byName = (first: Choice, second: Choice) =>
    compareNames(first.label, second.label)
  if (part === "owner") {
    if (!groups.organizations.length) return []
    return [
      { value: MY_VAULT, label: t("popup.main.filter.myVault") },
      ...groups.organizations
        .map((organization) => ({
          value: organization.id,
          label: organization.name,
        }))
        .sort(byName),
    ]
  }
  if (part === "folder") {
    if (!groups.folders.length) return []
    return [
      ...groups.folders
        .map((folder) => ({ value: folder.id, label: folder.name }))
        .sort(byName),
      { value: NO_FOLDER, label: t("popup.main.filter.noFolder") },
    ]
  }
  const organizations = new Map(
    groups.organizations.map((organization) => [
      organization.id,
      organization.name,
    ]),
  )
  // Collections of different organizations may share a name; each says whose it is.
  const shared =
    new Set(groups.collections.map((collection) => collection.name)).size <
    groups.collections.length
  return groups.collections
    .map((collection) => ({
      value: collection.id,
      label: shared
        ? `${collection.name} · ${organizations.get(collection.organizationId) ?? ""}`
        : collection.name,
    }))
    .sort(byName)
}

const PART_TEXT: Record<Part, { name: MessageKey; all: MessageKey }> = {
  owner: {
    name: "popup.main.filter.vault",
    all: "popup.main.filter.allVaults",
  },
  folder: {
    name: "popup.main.filter.folder",
    all: "popup.main.filter.allFolders",
  },
  collection: {
    name: "popup.main.filter.collection",
    all: "popup.main.filter.allCollections",
  },
}

/** Shows or hides an account's pickers; none for an account with nothing to filter by. */
export function GroupFilterButton({
  vaultId,
  size = "icon-xs",
}: {
  vaultId: string
  /** As tall as the controls beside it: a heading's, or the list header's. */
  size?: "icon-xs" | "icon-sm"
}) {
  const context = useContext(GroupFilterContext)
  if (!context) return null
  const { filters, vaults, onChange } = context
  if (!canFilter(vaults.find((vault) => vault.id === vaultId))) return null
  const shown = filters.shown.includes(vaultId)
  const toggle = () => {
    if (!shown) {
      onChange({ ...filters, shown: [...filters.shown, vaultId] })
      return
    }
    // Hiding the pickers drops what they chose, so nothing narrows the account unseen.
    const { [vaultId]: _dropped, ...choices } = filters.choices
    onChange({
      choices,
      shown: filters.shown.filter((id) => id !== vaultId),
    })
  }
  return (
    <Toggle
      size={size}
      className="text-muted-foreground"
      aria-label={t("popup.main.filter.toggle")}
      title={t("popup.main.filter.toggle")}
      pressed={shown}
      onPressedChange={toggle}
    >
      <ListFilterIcon />
    </Toggle>
  )
}

/** Pickers for an account's vault, folder and collection; a part it has nothing in is left out. */
export function GroupFilterBar({ vaultId }: { vaultId: string }) {
  const context = useContext(GroupFilterContext)
  const vault = context?.vaults.find((candidate) => candidate.id === vaultId)
  if (!context || !vault || !context.filters.shown.includes(vaultId))
    return null
  const { filters, onChange } = context
  const filter = filters.choices[vaultId] ?? NO_GROUP_FILTER
  const parts = (["owner", "folder", "collection"] as const)
    .map((part) => ({ part, choices: choicesOf(vault, part) }))
    .filter(({ choices }) => choices.length > 0)

  const choose = (part: Part, value: string) =>
    onChange({
      ...filters,
      choices: {
        ...filters.choices,
        [vaultId]: { ...filter, [part]: value === ALL ? null : value },
      },
    })

  return (
    <div className="flex gap-1.5 pr-3 pb-2 pl-2">
      {parts.map(({ part, choices }) => (
        <Select
          key={part}
          value={filter[part] ?? ALL}
          onValueChange={(next) => choose(part, next as string)}
          items={[{ value: ALL, label: t(PART_TEXT[part].name) }, ...choices]}
        >
          <SelectTrigger
            size="sm"
            className="min-w-0 flex-1 text-xs"
            aria-label={t(PART_TEXT[part].name)}
          >
            <SelectValue className="truncate" />
          </SelectTrigger>
          <SelectContent className="w-auto max-w-(--available-width) min-w-(--anchor-width)">
            <SelectGroup>
              <SelectItem value={ALL}>{t(PART_TEXT[part].all)}</SelectItem>
            </SelectGroup>
            <SelectGroup>
              <SelectSeparator />
              {choices.map((choice) => (
                <SelectItem key={choice.value} value={choice.value}>
                  <span className="max-w-64 truncate">{choice.label}</span>
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      ))}
    </div>
  )
}

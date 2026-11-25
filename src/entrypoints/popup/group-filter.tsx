import type { VaultView } from "@/background/api"
import { vaultLabel } from "@/components/keyward/brand-icon"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { currentLanguage, type MessageKey, t } from "@/lib/i18n"
import type { ItemGrouping } from "@/lib/providers/types"

/** The account's own vault, as an owner beside its organizations. */
const MY_VAULT = "mine"
/** Items in no folder, as a folder. */
const NO_FOLDER = "none"

/**
 * A narrowing of the list to one account's owner, folder and collection, as Bitwarden's own
 * filters do. Choices belong to one account at a time, as an account's folders and organizations
 * are its own.
 */
export interface GroupFilter {
  vaultId: string | null
  /** MY_VAULT or an organization ID. */
  owner: string | null
  /** A folder ID or NO_FOLDER. */
  folder: string | null
  collection: string | null
}

export const NO_GROUP_FILTER: GroupFilter = {
  vaultId: null,
  owner: null,
  folder: null,
  collection: null,
}

type Part = "owner" | "folder" | "collection"

export function isFiltering(filter: GroupFilter): boolean {
  return Boolean(filter.owner || filter.folder || filter.collection)
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

/** A vault with only the items the filter lets through; other accounts keep none while it is on. */
export function narrowed(vault: VaultView, filter: GroupFilter): VaultView {
  if (!isFiltering(filter)) return vault
  if (vault.id !== filter.vaultId) return { ...vault, logins: [], notes: [] }
  return {
    ...vault,
    logins: vault.logins.filter((login) => fits(login.grouping, filter)),
    notes: vault.notes?.filter((note) => fits(note.grouping, filter)),
  }
}

/** Whether the vaults have anything to filter by. */
export function canFilter(vaults: readonly VaultView[]): boolean {
  return vaults.some(
    (vault) =>
      vault.groups &&
      (vault.groups.organizations.length > 0 ||
        vault.groups.folders.length > 0 ||
        vault.groups.collections.length > 0),
  )
}

interface Choice {
  value: string
  label: string
}

const ALL = "all"

function encode(vaultId: string, id: string): string {
  return JSON.stringify([vaultId, id])
}

function decode(value: string): [string, string] | null {
  if (value === ALL) return null
  const parsed: unknown = JSON.parse(value)
  return Array.isArray(parsed) &&
    typeof parsed[0] === "string" &&
    typeof parsed[1] === "string"
    ? [parsed[0], parsed[1]]
    : null
}

/** Each vault's choices for one part of the filter, under the vault's name when there are several. */
function choicesOf(
  vaults: readonly VaultView[],
  part: Part,
): { vault: VaultView; choices: Choice[] }[] {
  const collator = new Intl.Collator(currentLanguage(), {
    numeric: true,
    sensitivity: "base",
  })
  const byName = (first: Choice, second: Choice) =>
    collator.compare(first.label, second.label)
  return vaults.flatMap((vault) => {
    const groups = vault.groups
    if (!groups) return []
    const choice = (id: string, label: string) => ({
      value: encode(vault.id, id),
      label,
    })
    let choices: Choice[] = []
    if (part === "owner" && groups.organizations.length) {
      choices = [
        choice(MY_VAULT, t("popup.main.filter.myVault")),
        ...groups.organizations
          .map((organization) => choice(organization.id, organization.name))
          .sort(byName),
      ]
    } else if (part === "folder" && groups.folders.length) {
      choices = [
        ...groups.folders
          .map((folder) => choice(folder.id, folder.name))
          .sort(byName),
        choice(NO_FOLDER, t("popup.main.filter.noFolder")),
      ]
    } else if (part === "collection") {
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
      choices = groups.collections
        .map((collection) =>
          choice(
            collection.id,
            shared
              ? `${collection.name} · ${organizations.get(collection.organizationId) ?? ""}`
              : collection.name,
          ),
        )
        .sort(byName)
    }
    return choices.length ? [{ vault, choices }] : []
  })
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

/** A row of pickers for the vault, folder and collection; a part with nothing to pick is left out. */
export function GroupFilterBar({
  vaults,
  filter,
  onChange,
}: {
  vaults: readonly VaultView[]
  filter: GroupFilter
  onChange: (filter: GroupFilter) => void
}) {
  const parts = (["owner", "folder", "collection"] as const)
    .map((part) => ({ part, sections: choicesOf(vaults, part) }))
    .filter(({ sections }) => sections.length > 0)

  const choose = (part: Part, value: string) => {
    const chosen = decode(value)
    // A choice from another account starts the filter over, as the other choices do not apply there.
    const base =
      chosen && chosen[0] !== filter.vaultId
        ? { ...NO_GROUP_FILTER, vaultId: chosen[0] }
        : filter
    const next = { ...base, [part]: chosen ? chosen[1] : null }
    onChange(isFiltering(next) ? next : NO_GROUP_FILTER)
  }

  return (
    <div className="flex gap-1.5 px-2 pb-2">
      {parts.map(({ part, sections }) => {
        const id = filter[part]
        const value = id && filter.vaultId ? encode(filter.vaultId, id) : ALL
        const several = sections.length > 1
        return (
          <Select
            key={part}
            value={value}
            onValueChange={(next) => choose(part, next as string)}
            items={[
              { value: ALL, label: t(PART_TEXT[part].name) },
              ...sections.flatMap(({ choices }) => choices),
            ]}
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
              {sections.map(({ vault, choices }) => (
                <SelectGroup key={vault.id}>
                  <SelectSeparator />
                  {several && <SelectLabel>{vaultLabel(vault)}</SelectLabel>}
                  {choices.map((choice) => (
                    <SelectItem key={choice.value} value={choice.value}>
                      <span className="max-w-64 truncate">{choice.label}</span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        )
      })}
    </div>
  )
}

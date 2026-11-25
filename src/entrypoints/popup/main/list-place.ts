import { useCallback, useState } from "react"
import type { ItemFilter } from "./all-items"
import { type AccountFilters, NO_ACCOUNT_FILTERS } from "./group-filter"
import type { ProviderTab } from "./lists"

/**
 * Where the main list was left. The popup keeps one for as long as it is open and the main view
 * writes to it as the user moves, so coming back from an item finds the list as it was.
 */
export interface ListPlace {
  tab: ProviderTab
  /** The list filter the user chose, or null while the site decides it. */
  itemFilter: ItemFilter | null
  /** Vaults whose logins for the site were folded. */
  foldedSiteVaults: ReadonlySet<string>
  groupFilters: AccountFilters
  scrollTop: number
}

export function newListPlace(): ListPlace {
  return {
    tab: "all",
    itemFilter: null,
    foldedSiteVaults: new Set(),
    groupFilters: NO_ACCOUNT_FILTERS,
    scrollTop: 0,
  }
}

/** One part of the list's place as state, whose setter also writes it to `place`. */
export function usePlaceState<Key extends keyof ListPlace>(
  place: ListPlace,
  key: Key,
): [ListPlace[Key], (value: ListPlace[Key]) => void] {
  const [value, setValue] = useState(place[key])
  const change = useCallback(
    (next: ListPlace[Key]) => {
      place[key] = next
      setValue(next)
    },
    [place, key],
  )
  return [value, change]
}

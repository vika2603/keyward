import { useCallback, useEffect, useMemo, useState } from "react"
import { callBackground, type VaultView } from "@/background/api"
import { isUnsupportedRequest } from "@/components/keyward/errors"
import { notifyError } from "@/components/keyward/notify"
import { useBackgroundQuery } from "@/hooks/use-background-query"
import { type AccountFilters, narrowed } from "./group-filter"
import { mainLists, type ProviderTab } from "./lists"

/** A search waits for typing to pause this long. */
const SEARCH_DELAY_MS = 150

const NO_VAULTS: VaultView[] = []

/**
 * Loads the page's vaults and every item of the vaults that list themselves whole, searches as the
 * query changes, and works out what the main list shows.
 */
export function useMainLists({
  query,
  tab,
  groupFilters,
}: {
  /** Searches the whole vault while not empty; the page's logins show otherwise. */
  query: string
  tab: ProviderTab
  groupFilters: AccountFilters
}) {
  const stateQuery = useBackgroundQuery("popup.state", null, {
    onError: notifyError,
  })
  const popupState = stateQuery.data
  /** Every item of the vaults that can list themselves whole, to browse instead of the site's logins. */
  const allItemsQuery = useBackgroundQuery("popup.allItems", null)
  /** Why the vaults could not be listed whole; shown only where the list would be. */
  const allItemsError = allItemsQuery.error
  const allItems = allItemsError ? NO_VAULTS : allItemsQuery.data
  const { reload: reloadState } = stateQuery
  const { reload: reloadAllItems } = allItemsQuery
  const load = useCallback(() => {
    reloadState()
    reloadAllItems()
  }, [reloadState, reloadAllItems])

  const [results, setResults] = useState<VaultView[] | null>(null)
  const [searchFailed, setSearchFailed] = useState(false)

  const lists = useMemo(
    () =>
      mainLists({
        vaults: popupState?.vaults ?? [],
        results,
        allItems,
        query,
        tab,
      }),
    [popupState, results, allItems, query, tab],
  )
  const { search, browsing, filterable } = lists

  // biome-ignore lint/correctness/useExhaustiveDependencies: each new state of the vaults, as after a lock, searches again.
  useEffect(() => {
    setResults(null)
    if (!search) return
    setSearchFailed(false)
    let stale = false
    const timer = setTimeout(() => {
      callBackground("popup.search", { query: search }).then(
        (found) => !stale && setResults(found),
        (error) => {
          if (stale) return
          setSearchFailed(true)
          notifyError(error)
        },
      )
    }, SEARCH_DELAY_MS)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [search, popupState])

  // Each account's group filter narrows its part of the list of whole vaults; the site's logins
  // are few and stay as they are.
  const browsed = useMemo(
    () =>
      filterable.map((vault) =>
        narrowed(vault, groupFilters.choices[vault.id]),
      ),
    [filterable, groupFilters],
  )

  // The whole vault is asked for on every opening; its failure matters only where it would show. A
  // background without the request leaves the site's logins, which need no message.
  useEffect(() => {
    if (browsing && allItemsError && !isUnsupportedRequest(allItemsError))
      notifyError(allItemsError)
  }, [browsing, allItemsError])

  const loading = popupState === null
  const waitingForItems = browsing && allItems === null
  return {
    ...lists,
    loading,
    /** A request failed and its toast shows; the list stops waiting for it. */
    failed: stateQuery.error !== null || searchFailed,
    page: popupState?.page ?? null,
    vaults: popupState?.vaults ?? [],
    browsed,
    browsable: browsing && browsed.length > 0,
    listReady: !(loading || (search && results === null) || waitingForItems),
    load,
  }
}

export type MainListsState = ReturnType<typeof useMainLists>

import type {
  EditableLogin,
  EditableNote,
  NewLoginDetails,
} from "@/lib/providers/types"
import { type ListPlace, newListPlace } from "./main/list-place"
import type { View } from "./views"

const VIEW_CACHE_KEY = "popup.viewCache"
/** Retain popup route, list state, and form drafts for 2 minutes across accidental closes. */
export const VIEW_CACHE_TTL_MS = 2 * 60_000

const CACHEABLE_VIEWS: ReadonlySet<View["name"]> = new Set([
  "main",
  "add",
  "detail",
  "edit",
  "note",
  "editNote",
  "generator",
  "history",
  "passwordHistory",
])

export interface SerializedListPlace {
  tab: ListPlace["tab"]
  itemFilter: ListPlace["itemFilter"]
  foldedSiteVaults: string[]
  groupFilters: ListPlace["groupFilters"]
  scrollTop: number
}

export interface AddLoginDraft {
  site: string
  username: string
  password: string
  vaultId: string | null
  folderId: string | null
  details: Omit<NewLoginDetails, "folderId">
}

export interface PopupViewCache {
  savedAt: number
  view: View
  query: string
  place: SerializedListPlace
  addDraft?: AddLoginDraft | null
  editDrafts?: Record<string, EditableLogin>
  noteDrafts?: Record<string, EditableNote>
}

export function serializeListPlace(place: ListPlace): SerializedListPlace {
  return {
    tab: place.tab,
    itemFilter: place.itemFilter,
    foldedSiteVaults: [...place.foldedSiteVaults],
    groupFilters: place.groupFilters,
    scrollTop: place.scrollTop,
  }
}

export function deserializeListPlace(saved: SerializedListPlace): ListPlace {
  return {
    tab: saved.tab,
    itemFilter: saved.itemFilter,
    foldedSiteVaults: new Set(saved.foldedSiteVaults),
    groupFilters: saved.groupFilters,
    scrollTop: saved.scrollTop,
  }
}

async function readRawCache(): Promise<PopupViewCache | null> {
  try {
    const stored = (await browser.storage.session.get(VIEW_CACHE_KEY))[
      VIEW_CACHE_KEY
    ] as PopupViewCache | undefined
    if (!stored || Date.now() - stored.savedAt > VIEW_CACHE_TTL_MS) return null
    return stored
  } catch {
    return null
  }
}

async function writeRawCache(cache: PopupViewCache): Promise<void> {
  try {
    await browser.storage.session.set({
      [VIEW_CACHE_KEY]: { ...cache, savedAt: Date.now() },
    })
  } catch {
    // Session storage failure should never block popup interaction.
  }
}

export async function loadViewCache(): Promise<PopupViewCache | null> {
  return readRawCache()
}

export async function saveNavigationState(
  view: View,
  query: string,
  place: ListPlace,
): Promise<void> {
  if (!CACHEABLE_VIEWS.has(view.name)) return
  const existing = await readRawCache()
  await writeRawCache({
    savedAt: Date.now(),
    view,
    query,
    place: serializeListPlace(place),
    addDraft: existing?.addDraft,
    editDrafts: existing?.editDrafts,
    noteDrafts: existing?.noteDrafts,
  })
}

export async function loadAddDraft(): Promise<AddLoginDraft | null> {
  return (await readRawCache())?.addDraft ?? null
}

export async function saveAddDraft(draft: AddLoginDraft | null): Promise<void> {
  const existing = await readRawCache()
  if (!existing && !draft) return
  await writeRawCache({
    savedAt: Date.now(),
    view: existing?.view ?? { name: "add" },
    query: existing?.query ?? "",
    place: existing?.place ?? serializeListPlace(newListPlace()),
    addDraft: draft,
    editDrafts: existing?.editDrafts,
    noteDrafts: existing?.noteDrafts,
  })
}

export async function loadEditDraft(
  key: string,
): Promise<EditableLogin | null> {
  return (await readRawCache())?.editDrafts?.[key] ?? null
}

export async function saveEditDraft(
  key: string,
  draft: EditableLogin | null,
): Promise<void> {
  const existing = await readRawCache()
  if (!existing && !draft) return
  const nextDrafts = { ...(existing?.editDrafts ?? {}) }
  if (draft) nextDrafts[key] = draft
  else delete nextDrafts[key]
  await writeRawCache({
    savedAt: Date.now(),
    view: existing?.view ?? { name: "main" },
    query: existing?.query ?? "",
    place: existing?.place ?? serializeListPlace(newListPlace()),
    addDraft: existing?.addDraft,
    editDrafts: nextDrafts,
    noteDrafts: existing?.noteDrafts,
  })
}

export async function loadNoteDraft(key: string): Promise<EditableNote | null> {
  return (await readRawCache())?.noteDrafts?.[key] ?? null
}

export async function saveNoteDraft(
  key: string,
  draft: EditableNote | null,
): Promise<void> {
  const existing = await readRawCache()
  if (!existing && !draft) return
  const nextDrafts = { ...(existing?.noteDrafts ?? {}) }
  if (draft) nextDrafts[key] = draft
  else delete nextDrafts[key]
  await writeRawCache({
    savedAt: Date.now(),
    view: existing?.view ?? { name: "main" },
    query: existing?.query ?? "",
    place: existing?.place ?? serializeListPlace(newListPlace()),
    addDraft: existing?.addDraft,
    editDrafts: existing?.editDrafts,
    noteDrafts: nextDrafts,
  })
}

export async function clearViewCache(): Promise<void> {
  try {
    await browser.storage.session.remove(VIEW_CACHE_KEY)
  } catch {
    // Ignore cleanup errors.
  }
}

import type { GeneratorKind } from "@/lib/generator"
import type { HistoryEntry } from "./api"

/** Generated values, newest first, kept in storage.session so they end with the browser; storage.local is not encrypted. */
const KEY = "generator.history"
/** The most entries kept, a cap Keyward chose; the oldest entries are dropped first. */
export const HISTORY_LIMIT = 100
/** How long the generator must keep showing a value before it counts as settled. */
export const SETTLE_DELAY_MS = 600

/** Entries stored by versions that kept only passwords have no kind, and name the value `password`. */
type StoredEntry = Omit<HistoryEntry, "value" | "kind"> & {
  value?: string
  password?: string
  kind?: GeneratorKind
}

interface Unsettled {
  value: string
  host: () => Promise<string | null>
  timer: ReturnType<typeof setTimeout>
}

/** The latest value of each kind the generator showed that has not settled yet, oldest first. */
const unsettled = new Map<GeneratorKind, Unsettled>()

export async function listHistory(): Promise<HistoryEntry[]> {
  const stored = (await browser.storage.session.get(KEY))[KEY]
  if (!Array.isArray(stored)) return []
  return (stored as StoredEntry[]).map(({ password, ...entry }) => ({
    ...entry,
    value: entry.value ?? password ?? "",
    kind: entry.kind ?? "password",
  }))
}

/** The last change of the stored list; each waits for the one before, so none is lost. */
let changing: Promise<unknown> = Promise.resolve()

export function addHistory(
  value: string,
  host: string | null,
  kind: GeneratorKind = "password",
): Promise<void> {
  const added = changing.then(() => prepend(value, host, kind))
  changing = added.catch(() => {})
  return added
}

async function prepend(
  value: string,
  host: string | null,
  kind: GeneratorKind,
): Promise<void> {
  const entries = await listHistory()
  if (entries[0]?.value === value) return
  const entry: HistoryEntry = {
    id: crypto.randomUUID(),
    value,
    kind,
    host,
    at: Date.now(),
  }
  await browser.storage.session.set({
    [KEY]: [entry, ...entries].slice(0, HISTORY_LIMIT),
  })
}

/**
 * Adds a value the generator shows once no other value of its kind has followed it for
 * SETTLE_DELAY_MS, so dragging the length slider adds only the length it stops at. The wait runs
 * here rather than in the popup, so the value still settles when the popup closes right away.
 */
export function addWhenSettled(
  value: string,
  kind: GeneratorKind,
  host: () => Promise<string | null>,
): void {
  const previous = unsettled.get(kind)
  if (previous) clearTimeout(previous.timer)
  // Deleting first moves the kind to the end, so the map stays in the order the values were shown.
  unsettled.delete(kind)
  const timer = setTimeout(() => {
    unsettled.delete(kind)
    void host()
      .then((hostname) => addHistory(value, hostname, kind))
      .catch(() => {})
  }, SETTLE_DELAY_MS)
  unsettled.set(kind, { value, host, timer })
}

/** Adds a shown value at once, as when it is copied before it settles. */
export async function addShownNow(
  value: string,
  kind: GeneratorKind,
  host: string | null,
): Promise<void> {
  const waiting = unsettled.get(kind)
  if (waiting?.value === value) {
    clearTimeout(waiting.timer)
    unsettled.delete(kind)
  }
  await addHistory(value, host, kind)
}

/** Adds the values still waiting to settle, so a history read right after generating includes them. */
export async function settleNow(): Promise<void> {
  const waiting = [...unsettled]
  unsettled.clear()
  for (const [kind, { value, host, timer }] of waiting) {
    clearTimeout(timer)
    await addHistory(value, await host(), kind)
  }
}

export function clearHistory(): Promise<void> {
  for (const { timer } of unsettled.values()) clearTimeout(timer)
  unsettled.clear()
  const cleared = changing.then(() => browser.storage.session.remove(KEY))
  changing = cleared.catch(() => {})
  return cleared
}

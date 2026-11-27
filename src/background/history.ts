import { storage } from "wxt/utils/storage"
import type { GeneratorKind } from "@/lib/generator"
import { serialQueue } from "@/lib/serial-queue"
import {
  type EarlierHistoryEntry,
  type HistoryEntry,
  historyEntryOf,
} from "./api"

/** Generated values, newest first, kept in storage.session so they end with the browser; storage.local is not encrypted. */
const historyItem = storage.defineItem<EarlierHistoryEntry[]>(
  "session:generator.history",
  { fallback: [] },
)
/** The most entries kept, a cap Keyward chose; the oldest entries are dropped first. */
export const HISTORY_LIMIT = 100
/** How long the generator must keep showing a value before it counts as settled. */
export const SETTLE_DELAY_MS = 600

interface Unsettled {
  value: string
  host: () => Promise<string | null>
  timer: ReturnType<typeof setTimeout>
}

/** The latest value of each kind the generator showed that has not settled yet, oldest first. */
const unsettled = new Map<GeneratorKind, Unsettled>()

export async function listHistory(): Promise<HistoryEntry[]> {
  const stored = await historyItem.getValue()
  return Array.isArray(stored) ? stored.map(historyEntryOf) : []
}

/** Changes to the stored list run one after another, so none is lost. */
const historyChange = serialQueue()

export function addHistory(
  value: string,
  host: string | null,
  kind: GeneratorKind = "password",
): Promise<void> {
  return historyChange(() => prepend(value, host, kind))
}

async function prepend(
  value: string,
  host: string | null,
  kind: GeneratorKind,
): Promise<void> {
  const entries = await listHistory()
  // A value already listed keeps its place, so copying or filling it again adds nothing.
  if (entries.some((listed) => listed.value === value)) return
  const entry: HistoryEntry = {
    id: crypto.randomUUID(),
    value,
    kind,
    host,
    at: Date.now(),
  }
  await historyItem.setValue([entry, ...entries].slice(0, HISTORY_LIMIT))
}

/**
 * Adds a value the generator shows for a changed option once no other value of its kind has
 * followed it for SETTLE_DELAY_MS, so dragging the length slider adds only the length it stops at.
 * The wait runs here rather than in the popup, so the value still settles when the popup closes
 * right away.
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

/**
 * Adds a value the generator shows at once: one it generates on opening or on request, or one
 * copied before it settles. A different value of its kind still waiting to settle was replaced too
 * soon to count, so it is dropped. The change is queued before the host is looked up, so values
 * enter the history in the order they were shown.
 */
export function addShownNow(
  value: string,
  kind: GeneratorKind,
  host: () => Promise<string | null>,
): Promise<void> {
  const waiting = unsettled.get(kind)
  if (waiting) clearTimeout(waiting.timer)
  unsettled.delete(kind)
  return historyChange(async () => prepend(value, await host(), kind))
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
  return historyChange(() => historyItem.removeValue())
}

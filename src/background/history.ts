import type { HistoryEntry } from "./api"

/** Generated passwords that were copied or generated in the add view, kept in storage.session so they end with the browser. */
const KEY = "generator.history"

export async function listHistory(): Promise<HistoryEntry[]> {
  const stored = (await browser.storage.session.get(KEY))[KEY]
  return Array.isArray(stored) ? (stored as HistoryEntry[]) : []
}

export async function addHistory(
  password: string,
  host: string | null,
): Promise<void> {
  const entries = await listHistory()
  if (entries[0]?.password === password) return
  const entry: HistoryEntry = {
    id: crypto.randomUUID(),
    password,
    host,
    at: Date.now(),
  }
  await browser.storage.session.set({ [KEY]: [entry, ...entries] })
}

export async function clearHistory(): Promise<void> {
  await browser.storage.session.remove(KEY)
}

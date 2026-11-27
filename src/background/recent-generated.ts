import { storage } from "wxt/utils/storage"
import { serialQueue } from "@/lib/serial-queue"

/** A generated password stays reusable on the same tab and site for this long. */
const GENERATED_TTL_MS = 10 * 60_000

export interface RememberedGenerated {
  site: string
  /** Origin and pathname of the page where the password was generated or filled. */
  pageKey: string
  password: string
  /** Whether the password has actually been filled into a field on the page. */
  filled: boolean
  at: number
}

type GeneratedByTab = Record<string, RememberedGenerated>

const generatedItem = storage.defineItem<GeneratedByTab>(
  "session:save.generated",
  { fallback: {} },
)
const generatedChange = serialQueue()

function changeGenerated(
  change: (entries: GeneratedByTab) => GeneratedByTab,
): Promise<void> {
  return generatedChange(async () =>
    generatedItem.setValue(change(await generatedItem.getValue())),
  )
}

export function pageKeyOf(page: URL): string {
  return `${page.origin}${page.pathname}`
}

/** Caches a generated password for this tab and site so confirm-password fields reuse it. */
export function rememberGenerated(
  tabId: number,
  site: string,
  page: URL,
  password: string,
  filled: boolean,
): Promise<void> {
  return changeGenerated((entries) => {
    const previous = entries[tabId]
    const keepFilled =
      filled ||
      (previous?.site === site &&
        previous.password === password &&
        previous.filled)
    return {
      ...entries,
      [tabId]: {
        site,
        pageKey: pageKeyOf(page),
        password,
        filled: keepFilled,
        at: Date.now(),
      },
    }
  })
}

export async function recallGenerated(
  tabId: number,
  site: string,
): Promise<RememberedGenerated | null> {
  const entry = (await generatedItem.getValue())[tabId]
  if (!entry || entry.site !== site || Date.now() - entry.at > GENERATED_TTL_MS)
    return null
  return entry
}

export function forgetGenerated(tabId: number): Promise<void> {
  return changeGenerated(({ [tabId]: _forgotten, ...rest }) => rest)
}

import { storage } from "wxt/utils/storage"
import { serialQueue } from "@/lib/serial-queue"

/**
 * How long an item stays open after its master password was entered again, so viewing it and
 * copying from it do not each ask. Keyward's choice; Bitwarden's apps ask for each action.
 */
const REPROMPT_PASS_MS = 5 * 60_000

/** Items whose master password was entered again, by `vaultId|itemId`, with when each pass ends. */
const passesItem = storage.defineItem<Record<string, number>>(
  "session:bitwarden.repromptPasses",
  { fallback: {} },
)
/** Changes to the stored passes run one after another, so none is lost. */
const passesChange = serialQueue()

const passKey = (vaultId: string, itemId: string) => `${vaultId}|${itemId}`

/** What editing and re-prompt checks need of a login or a note. */
export interface RepromptItem {
  id: string
  reprompt: boolean
}

/** The item as Keyward may treat it: one whose master password was entered again acts as open. */
export async function withPass<Item extends RepromptItem>(
  vaultId: string,
  item: Item,
): Promise<Item> {
  if (!item.reprompt) return item
  const until = (await passesItem.getValue())[passKey(vaultId, item.id)]
  return until !== undefined && until > Date.now()
    ? { ...item, reprompt: false }
    : item
}

/** Opens an item for a few minutes; ended passes are dropped on the way. */
export function grantPass(vaultId: string, itemId: string): Promise<void> {
  return passesChange(async () => {
    const now = Date.now()
    const current = Object.entries(await passesItem.getValue()).filter(
      ([, until]) => until > now,
    )
    await passesItem.setValue({
      ...Object.fromEntries(current),
      [passKey(vaultId, itemId)]: now + REPROMPT_PASS_MS,
    })
  })
}

/** Ends the passes of a vault, as it is locked or signed out. */
export function dropRepromptPasses(vaultId: string): Promise<void> {
  return passesChange(async () => {
    const kept = Object.entries(await passesItem.getValue()).filter(
      ([key]) => !key.startsWith(`${vaultId}|`),
    )
    await passesItem.setValue(Object.fromEntries(kept))
  })
}

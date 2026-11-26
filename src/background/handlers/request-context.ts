import type { Sender } from "@/lib/messaging"
import { type TabRef, VaultError } from "@/lib/providers/types"
import { menuSessions } from "../overlays"
import { activeTab, sendToFrame, webPage } from "../page"

/** The senders the toolbar popup's requests come from. */
export const popupOnly = ["popup"] as const
/** The pages that connect vaults: the popup and the options page. */
export const connectPages = ["popup", "options"] as const
/** The pages that sign in to Bitwarden: those that connect vaults, and the welcome page. */
export const signInPages = [...connectPages, "welcomePage"] as const

export function tabFrame(sender: Sender): { tabId: number; frameId: number } {
  if (sender.tab?.id === undefined || sender.frameId === undefined) {
    throw new VaultError("The request has no tab", "forbidden")
  }
  return { tabId: sender.tab.id, frameId: sender.frameId }
}

export async function closeMenu(tabId: number): Promise<void> {
  const session = await menuSessions.get(tabId)
  if (!session) return
  await menuSessions.remove(tabId)
  await sendToFrame(tabId, session.frameId, { type: "menu.close" }).catch(
    () => {},
  )
}

export async function activePage(): Promise<{
  tabId: number | undefined
  page: URL | null
}> {
  const tab = await activeTab()
  return { tabId: tab?.id, page: webPage(tab?.url) }
}

export async function activeHost(): Promise<string | null> {
  return (await activePage()).page?.hostname ?? null
}

/** The tab a popup read is reported for; Apple's helper only uses it to route its reply. */
export async function popupTab(): Promise<TabRef> {
  const tab = await activeTab()
  return { tabId: tab?.id ?? 0, frameId: 0 }
}

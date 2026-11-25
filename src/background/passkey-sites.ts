import { storage } from "wxt/utils/storage"
import { siteDomainOf } from "@/lib/site"

const MAX_SITES = 500

/**
 * Sites where a passkey sign-in succeeded in this browser, most recent first. The browser does not
 * tell extensions which sites have passkeys, so these are the sites whose passkey requests the menu
 * offers; elsewhere the browser's own list, shown only when it has passkeys, keeps them. Holds
 * registrable domains only.
 */
const passkeySitesItem = storage.defineItem<string[]>("local:passkeySites", {
  fallback: [],
})

export async function hasPasskeySite(page: URL): Promise<boolean> {
  return (await passkeySitesItem.getValue()).includes(
    siteDomainOf(page.hostname),
  )
}

export async function rememberPasskeySite(page: URL): Promise<void> {
  const site = siteDomainOf(page.hostname)
  const sites = await passkeySitesItem.getValue()
  if (sites[0] === site) return
  await passkeySitesItem.setValue(
    [site, ...sites.filter((known) => known !== site)].slice(0, MAX_SITES),
  )
}

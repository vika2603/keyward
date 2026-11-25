export interface ServerUrls {
  /** What the user entered, normalized; empty for the official service. */
  base: string
  api: string
  identity: string
}

const OFFICIAL: ServerUrls = {
  base: "",
  api: "https://api.bitwarden.com",
  identity: "https://identity.bitwarden.com",
}

/** Resolves the endpoints of a server address; an empty address means the official service. */
export function serverUrls(address: string): ServerUrls {
  const base = normalizeServerAddress(address)
  if (!base) return OFFICIAL
  return { base, api: `${base}/api`, identity: `${base}/identity` }
}

export function normalizeServerAddress(address: string): string {
  const trimmed = address.trim()
  if (!trimmed) return ""
  const url = new URL(
    /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
  )
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("Unsupported address")
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`
}

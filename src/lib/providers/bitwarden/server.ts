export interface ServerUrls {
  /** What the user entered, normalized; empty for bitwarden.com. */
  base: string
  api: string
  identity: string
}

/** Endpoints a self-hosted server runs at addresses of their own; a missing one follows the address. */
export interface CustomEndpoints {
  api?: string
  identity?: string
}

/** The address that stands for Bitwarden's EU cloud; bitwarden.com is the empty address. */
export const EU_SERVER = "https://vault.bitwarden.eu"

/** Bitwarden's cloud regions by address, with their endpoints as the official clients list them. */
const CLOUDS: Record<string, { urls: ServerUrls; domain: string }> = {
  "": {
    urls: {
      base: "",
      api: "https://api.bitwarden.com",
      identity: "https://identity.bitwarden.com",
    },
    domain: "bitwarden.com",
  },
  [EU_SERVER]: {
    urls: {
      base: EU_SERVER,
      api: "https://api.bitwarden.eu",
      identity: "https://identity.bitwarden.eu",
    },
    domain: "bitwarden.eu",
  },
}

/** Resolves the endpoints of a server address; an empty address means bitwarden.com. */
export function serverUrls(
  address: string,
  endpoints: CustomEndpoints = {},
): ServerUrls {
  const base = normalizeServerAddress(address)
  const derived = CLOUDS[base]?.urls ?? {
    base,
    api: `${base}/api`,
    identity: `${base}/identity`,
  }
  return {
    base: derived.base,
    api: normalizeServerAddress(endpoints.api ?? "") || derived.api,
    identity:
      normalizeServerAddress(endpoints.identity ?? "") || derived.identity,
  }
}

/** The host an account's server is known by: a cloud region's domain, or the address's host. */
export function serverHost(address: string): string {
  const base = normalizeServerAddress(address)
  return CLOUDS[base]?.domain ?? new URL(base).host
}

/** Whether an address is one of Bitwarden's cloud regions rather than a self-hosted server. */
export function isCloudServer(address: string): boolean {
  return normalizeServerAddress(address) in CLOUDS
}

export function normalizeServerAddress(address: string): string {
  const trimmed = address.trim()
  if (!trimmed) return ""
  const url = new URL(
    /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
  )
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("Unsupported address")
  // Chrome's parser takes spaces in a host and escapes them, where the URL standard refuses them.
  if (/\s/.test(trimmed) || url.hostname.includes("%"))
    throw new Error("Invalid address")
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`
}

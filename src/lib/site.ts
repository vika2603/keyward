import { getDomain, getHostname } from "tldts"

export function isWebUrl(url: string | undefined | null): url is string {
  return !!url && /^https?:\/\//i.test(url)
}

export function parseUrl(url: string | undefined | null): URL | null {
  if (!url) return null
  try {
    return new URL(url)
  } catch {
    return null
  }
}

/** The registrable domain, such as `github.com` for `gist.github.com`; IP addresses and hosts without one map to themselves. */
export function siteDomainOf(host: string): string {
  return getDomain(host, { allowPrivateDomains: true }) ?? host.toLowerCase()
}

/**
 * Hosts whose icon can stand for `host`, best first: the host itself, then its registrable domain
 * and that domain's www form. The browser keeps icons by the host it visited, and a bare domain
 * that redirects to its www form, as google.com does, has none of its own.
 */
export function iconHostsOf(host: string): string[] {
  const own = host.toLowerCase()
  const domain = getDomain(own, { allowPrivateDomains: true })
  if (!domain) return [own]
  return [...new Set([own, domain, `www.${domain}`])]
}

/** True when `host` equals `parent` or is one of its subdomains. */
export function isHostOrSubdomain(host: string, parent: string): boolean {
  const hostName = host.toLowerCase().replace(/\.$/, "")
  const parentName = parent.toLowerCase().replace(/\.$/, "")
  return hostName === parentName || hostName.endsWith(`.${parentName}`)
}

/** `address` as it is when it starts with a scheme and `//`, such as `ftp://`; otherwise behind `scheme://`. */
export function withScheme(address: string, scheme: "http" | "https"): string {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(address)
    ? address
    : `${scheme}://${address}`
}

/**
 * Whether `host` is labels of ASCII letters, digits and hyphens joined by single dots, such as a
 * punycode domain or an IPv4 address. A trailing dot, an empty label or an IPv6 address fails.
 */
export function isHostName(host: string): boolean {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*$/i.test(host)
}

/** Host name of a saved address, which may lack a scheme. */
export function hostOfSavedUri(uri: string): string | null {
  const trimmed = uri.trim()
  if (!trimmed) return null
  return getHostname(withScheme(trimmed, "http"))?.toLowerCase() ?? null
}

/** Whether `host` refers to the local loopback interface (`localhost`, `*.localhost`, `127.0.0.1`, `::1`). */
export function isLoopbackHost(host: string): boolean {
  const lower = host.toLowerCase().replace(/\.$/, "")
  return (
    lower === "localhost" ||
    lower.endsWith(".localhost") ||
    lower === "127.0.0.1" ||
    lower === "::1" ||
    lower === "[::1]"
  )
}

/** Accepts a bare host or a URL typed by the user and returns an https URL, or null. */
export function normalizeSiteInput(input: string): URL | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const url = parseUrl(isWebUrl(trimmed) ? trimmed : `https://${trimmed}`)
  if (
    !url ||
    !/^[a-z0-9.-]+$/i.test(url.hostname) ||
    !url.hostname.includes(".")
  )
    return null
  return url
}

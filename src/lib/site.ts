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

/** Host name of a saved address, which may lack a scheme. */
export function hostOfSavedUri(uri: string): string | null {
  const trimmed = uri.trim()
  if (!trimmed) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`
  return getHostname(withScheme)?.toLowerCase() ?? null
}

/** Accepts a bare host or a URL typed by the user and returns an https URL, or null. */
export function normalizeSiteInput(input: string): URL | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const url = parseUrl(
    /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
  )
  if (
    !url ||
    !/^[a-z0-9.-]+$/i.test(url.hostname) ||
    !url.hostname.includes(".")
  )
    return null
  return url
}

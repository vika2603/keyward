import { MatchType, type SiteRule } from "./settings"
import {
  hostOfSavedUri,
  isHostOrSubdomain,
  parseUrl,
  siteDomainOf,
} from "./site"

export interface MatchOptions {
  defaultMatch: MatchType
  equivalentDomains: string[][]
}

/** Domains treated as the same site as `domain`, including itself. */
function equivalentsOf(domain: string, groups: string[][]): Set<string> {
  const result = new Set([domain])
  for (const group of groups) {
    const normalized = group.map((d) => d.trim().toLowerCase()).filter(Boolean)
    if (normalized.includes(domain)) for (const d of normalized) result.add(d)
  }
  return result
}

/**
 * Whether a saved address matches a page, using the entry's own match type or the default.
 * Follows Bitwarden's rules: a domain match compares registrable domains, a host match
 * compares host and port, and an address without a scheme is read as http.
 */
export function uriMatches(
  saved: string,
  match: MatchType | null,
  page: URL,
  options: MatchOptions,
): boolean {
  const type = match ?? options.defaultMatch
  if (type === MatchType.Never || !saved.trim()) return false
  // A login saved for https is not offered to the same site over plain http.
  if (/^https:/i.test(saved.trim()) && page.protocol === "http:") return false
  switch (type) {
    case MatchType.Domain: {
      const host = hostOfSavedUri(saved)
      if (!host) return false
      const pageDomain = siteDomainOf(page.hostname)
      return equivalentsOf(pageDomain, options.equivalentDomains).has(
        siteDomainOf(host),
      )
    }
    case MatchType.Host: {
      const url = parseUrl(
        /^[a-z][a-z0-9+.-]*:\/\//i.test(saved) ? saved : `http://${saved}`,
      )
      return !!url && url.host.toLowerCase() === page.host.toLowerCase()
    }
    case MatchType.StartsWith:
      return page.href.startsWith(saved)
    case MatchType.Exact:
      return page.href === saved
    case MatchType.RegularExpression:
      try {
        return new RegExp(saved, "i").test(page.href)
      } catch {
        return false
      }
    default:
      return false
  }
}

/** The most specific site rule for a host: the one with the longest host that covers it. */
export function ruleForHost(rules: SiteRule[], host: string): SiteRule | null {
  let best: SiteRule | null = null
  for (const rule of rules) {
    if (!isHostOrSubdomain(host, rule.host)) continue
    if (!best || rule.host.length > best.host.length) best = rule
  }
  return best
}

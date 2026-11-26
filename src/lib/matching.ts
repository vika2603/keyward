import { MatchType, type SiteRule } from "./settings"
import {
  hostOfSavedUri,
  isHostOrSubdomain,
  parseUrl,
  siteDomainOf,
  withScheme,
} from "./site"
import appleSharedLogins from "./site-data/apple-shared-credentials.json"

/**
 * An entry of Apple's list of sites that share accounts: its domains share logins with each
 * other, or logins saved for its `from` domains also serve its `to` domains, as after a site
 * moved. A domain covers itself and its subdomains, so a host such as id.atlassian.com leaves out
 * the rest of its site.
 */
type SharedLogins =
  | { shared: string[] }
  | { from: string[]; to: string[]; fromDomainsAreObsoleted?: boolean }

const SHARED_LOGINS: readonly SharedLogins[] = appleSharedLogins

interface MatchOptions {
  defaultMatch: MatchType
  equivalentDomains: string[][]
}

/**
 * Equivalence groups as registrable domains, parsed once per groups array, since a listing matches
 * every saved address against the same groups. Settings are replaced, never changed in place, so
 * an array's groups stay the same.
 */
const siteGroupsCache = new WeakMap<string[][], string[][]>()

/** A group entry may be any host of its site, such as www.example.com; it stands for the whole site. */
function siteGroupsOf(groups: string[][]): string[][] {
  let siteGroups = siteGroupsCache.get(groups)
  if (!siteGroups) {
    siteGroups = groups.map((group) =>
      group
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean)
        .map(siteDomainOf),
    )
    siteGroupsCache.set(groups, siteGroups)
  }
  return siteGroups
}

/** Registrable domains treated as the same site as `domain`, including itself. */
function equivalentsOf(domain: string, groups: string[][]): Set<string> {
  const result = new Set([domain])
  for (const siteGroup of siteGroupsOf(groups))
    if (siteGroup.includes(domain))
      for (const member of siteGroup) result.add(member)
  return result
}

function covers(domains: readonly string[], host: string): boolean {
  return domains.some((domain) => isHostOrSubdomain(host, domain))
}

/** The page host `sharedSourcesOf` last answered for, as a listing asks for one page many times. */
let lastSharedSources = { host: "", sources: [] as string[] }

/** The domains of Apple's list whose logins a page on `host` may use, its own included. */
function sharedSourcesOf(host: string): string[] {
  if (lastSharedSources.host === host) return lastSharedSources.sources
  const sources: string[] = []
  for (const entry of SHARED_LOGINS) {
    if ("shared" in entry) {
      if (covers(entry.shared, host)) sources.push(...entry.shared)
    } else if (covers(entry.to, host)) {
      sources.push(...entry.from)
    }
  }
  lastSharedSources = { host, sources }
  return sources
}

/**
 * The other sites whose logins a page on `host` may use: those the settings make equivalent to its
 * site, as registrable domains, and those Apple's list shares logins with, as the list names them.
 */
export function equivalentDomainsOf(
  host: string,
  groups: string[][],
): string[] {
  const domain = siteDomainOf(host)
  const fromSettings = [...equivalentsOf(domain, groups)].filter(
    (member) => member !== domain,
  )
  const fromList = sharedSourcesOf(host).filter(
    (source) => !isHostOrSubdomain(host, source),
  )
  return [...new Set([...fromSettings, ...fromList])]
}

/**
 * Whether a saved address matches a page, using the entry's own match type or the default.
 * Follows Bitwarden's rules: a domain match compares registrable domains, a host match
 * compares host and port, and an address without a scheme is read as http. A domain match also
 * takes the sites the settings make equivalent and those Apple's list shares logins with.
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
      return (
        equivalentsOf(pageDomain, options.equivalentDomains).has(
          siteDomainOf(host),
        ) || covers(sharedSourcesOf(page.hostname), host)
      )
    }
    case MatchType.Host: {
      const url = parseUrl(withScheme(saved, "http"))
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

/**
 * Declarative per-site overrides for pages whose markup misleads heuristics. Every selector is
 * checked against the live DOM; when a site changes its markup and a selector matches nothing,
 * detection falls back to heuristics.
 */

import rawSiteFixes from "@/lib/site-data/site-fixes.json"
import { composedClosest } from "./deep-dom"

export type ForcedFieldKind =
  | "username"
  | "currentPassword"
  | "newPassword"
  | "code"
  | "unknown"

export type ForcedFormKind = "login" | "signup"

export interface SiteFailsafe {
  maxInputsPerPage?: number
  maxInputsPerForm?: number
}

export interface SiteFixRule {
  domain: string
  urlPattern?: string
  inputTypeSettings?: Record<string, ForcedFieldKind>
  formTypeSettings?: Record<string, ForcedFormKind>
  formBoundarySelector?: string
  failsafeSettings?: SiteFailsafe
}

export interface ActiveSiteFixes {
  inputTypeSettings: readonly (readonly [
    selector: string,
    kind: ForcedFieldKind,
  ])[]
  formTypeSettings: readonly (readonly [
    selector: string,
    kind: ForcedFormKind,
  ])[]
  formBoundarySelectors: readonly string[]
  maxInputsPerPage: number
  maxInputsPerForm: number
}

/**
 * Default upper bounds that keep giant data grids or spreadsheets from stalling page scans.
 * Sites with legitimate large pages can raise or disable scanning via `failsafeSettings`.
 */
export const DEFAULT_MAX_INPUTS_PER_PAGE = 500
export const DEFAULT_MAX_INPUTS_PER_FORM = 200

const SITE_FIXES = rawSiteFixes as SiteFixRule[]

const EMPTY_FIXES: ActiveSiteFixes = {
  inputTypeSettings: [],
  formTypeSettings: [],
  formBoundarySelectors: [],
  maxInputsPerPage: DEFAULT_MAX_INPUTS_PER_PAGE,
  maxInputsPerForm: DEFAULT_MAX_INPUTS_PER_FORM,
}

function hostMatchesDomain(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase()
  const target = domain.toLowerCase()
  return host === target || host.endsWith(`.${target}`)
}

function urlMatchesPattern(pathAndSearch: string, pattern: string): boolean {
  try {
    return new RegExp(pattern, "i").test(pathAndSearch)
  } catch {
    return false
  }
}

/** Resolves all declarative rules that apply to `location`, or defaults when none match. */
export function siteFixesFor(
  location: Pick<Location, "hostname" | "pathname" | "search"> | null,
  rules: readonly SiteFixRule[] = SITE_FIXES,
): ActiveSiteFixes {
  const hostname = location?.hostname
  if (!hostname) return EMPTY_FIXES
  const pathAndSearch = `${location.pathname ?? ""}${location.search ?? ""}`
  const matching = rules.filter(
    (rule) =>
      hostMatchesDomain(hostname, rule.domain) &&
      (!rule.urlPattern || urlMatchesPattern(pathAndSearch, rule.urlPattern)),
  )
  if (!matching.length) return EMPTY_FIXES

  const inputTypeSettings: [string, ForcedFieldKind][] = []
  const formTypeSettings: [string, ForcedFormKind][] = []
  const formBoundarySelectors: string[] = []
  let maxInputsPerPage = DEFAULT_MAX_INPUTS_PER_PAGE
  let maxInputsPerForm = DEFAULT_MAX_INPUTS_PER_FORM

  for (const rule of matching) {
    if (rule.inputTypeSettings)
      inputTypeSettings.push(...Object.entries(rule.inputTypeSettings))
    if (rule.formTypeSettings)
      formTypeSettings.push(...Object.entries(rule.formTypeSettings))
    if (rule.formBoundarySelector)
      formBoundarySelectors.push(rule.formBoundarySelector)
    if (rule.failsafeSettings?.maxInputsPerPage !== undefined)
      maxInputsPerPage = rule.failsafeSettings.maxInputsPerPage
    if (rule.failsafeSettings?.maxInputsPerForm !== undefined)
      maxInputsPerForm = rule.failsafeSettings.maxInputsPerForm
  }

  return {
    inputTypeSettings,
    formTypeSettings,
    formBoundarySelectors,
    maxInputsPerPage,
    maxInputsPerForm,
  }
}

function safeMatches(element: Element, selector: string): boolean {
  try {
    return element.matches(selector)
  } catch {
    return false
  }
}

/** Forced field role from matching site rules, or null to fall back to heuristics. */
export function forcedFieldKind(
  input: HTMLInputElement,
  fixes: ActiveSiteFixes,
): ForcedFieldKind | null {
  for (const [selector, kind] of fixes.inputTypeSettings) {
    if (safeMatches(input, selector)) return kind
  }
  return null
}

/** Forced form kind for `element`'s enclosing selector, or null to fall back to heuristics. */
export function forcedFormKind(
  element: Element,
  fixes: ActiveSiteFixes,
): ForcedFormKind | null {
  for (const [selector, kind] of fixes.formTypeSettings) {
    try {
      if (composedClosest(element, selector)) return kind
    } catch {
      // Ignore malformed selectors and keep falling back to heuristics.
    }
  }
  return null
}

/** Forced scope container matching `formBoundarySelectors`, or null to fall back to normal scope. */
export function forcedBoundaryOf(
  element: Element,
  fixes: ActiveSiteFixes,
): Element | null {
  for (const selector of fixes.formBoundarySelectors) {
    try {
      const boundary = composedClosest(element, selector)
      if (boundary) return boundary
    } catch {
      // Ignore malformed selectors and keep falling back to normal scope.
    }
  }
  return null
}

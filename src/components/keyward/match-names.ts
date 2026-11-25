import { t } from "@/lib/i18n"
import { MatchType } from "@/lib/settings"

/** The ways a saved web address can be compared with a page, by name. */
export function matchNames(): [MatchType, string][] {
  return [
    [MatchType.Domain, t("options.sites.match.domain")],
    [MatchType.Host, t("options.sites.match.host")],
    [MatchType.StartsWith, t("options.sites.match.startsWith")],
    [MatchType.Exact, t("options.sites.match.exact")],
    [MatchType.RegularExpression, t("options.sites.match.regularExpression")],
    [MatchType.Never, t("options.sites.match.never")],
  ]
}

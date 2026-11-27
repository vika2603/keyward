import {
  CheckCircle2Icon,
  ExternalLinkIcon,
  GlobeLockIcon,
  KeyRoundIcon,
  Repeat2Icon,
  ShieldAlertIcon,
} from "lucide-react"
import { useState } from "react"
import { callBackground } from "@/background/api"
import { FADE_IN } from "@/components/keyward/loading"
import { notify, notifyError } from "@/components/keyward/notify"
import { SiteIcon } from "@/components/keyward/site-icon"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useBackgroundQuery } from "@/hooks/use-background-query"
import { t } from "@/lib/i18n"
import type { SecurityAuditFinding } from "@/lib/providers/bitwarden/bitwarden-provider"
import type { LoginSummary, VaultInfo } from "@/lib/providers/types"
import { cn } from "@/lib/utils"
import { BackHeader } from "./header"
import { closeIfPopup } from "./pop-out"

function FindingRow({
  finding,
  badge,
  onOpen,
}: {
  finding: SecurityAuditFinding
  badge?: string
  onOpen: (vault: VaultInfo, login: LoginSummary) => void
}) {
  const [checking, setChecking] = useState(false)
  const [breachCount, setBreachCount] = useState<number | null>(null)

  const checkBreach = async () => {
    setChecking(true)
    try {
      const { count } = await callBackground("popup.checkBreach", {
        vaultId: finding.vault.id,
        loginId: finding.login.id,
      })
      setBreachCount(count)
      notify(
        count > 0
          ? t("popup.security.breachFound", { count })
          : t("popup.security.breachClear"),
      )
    } catch (error) {
      notifyError(error)
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="flex items-center gap-2 border-t px-2.5 py-2 first:border-t-0">
      <button
        type="button"
        onClick={() => onOpen(finding.vault, finding.login)}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md text-left outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <SiteIcon
          host={finding.login.host}
          text={finding.login.title || finding.login.username}
          className="size-7 shrink-0"
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">
            {finding.login.title || finding.login.username}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {finding.login.username || finding.login.host}
            {badge ? ` · ${badge}` : ""}
            {breachCount !== null &&
              ` · ${
                breachCount > 0
                  ? t("popup.security.breachShort", { count: breachCount })
                  : t("popup.security.breachSafeShort")
              }`}
          </span>
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={checking}
          aria-label={t("popup.security.checkBreach")}
          title={t("popup.security.checkBreach")}
          onClick={() => void checkBreach()}
        >
          <ShieldAlertIcon />
        </Button>
        {finding.changePasswordUrl && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t("popup.security.changePassword")}
            title={t("popup.security.changePassword")}
            onClick={() => {
              if (!finding.changePasswordUrl) return
              void browser.tabs.create({ url: finding.changePasswordUrl })
              closeIfPopup()
            }}
          >
            <ExternalLinkIcon />
          </Button>
        )}
      </div>
    </div>
  )
}

function AuditSection({
  title,
  findings,
  badgeOf,
  onOpen,
}: {
  title: string
  findings: readonly SecurityAuditFinding[]
  badgeOf?: (finding: SecurityAuditFinding) => string
  onOpen: (vault: VaultInfo, login: LoginSummary) => void
}) {
  if (!findings.length) return null
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="px-1 text-xs font-medium text-muted-foreground">
        {title} ({findings.length})
      </h2>
      <div className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-2xs">
        {findings.map((finding) => (
          <FindingRow
            key={`${finding.vault.id}:${finding.login.id}`}
            finding={finding}
            badge={badgeOf?.(finding)}
            onOpen={onOpen}
          />
        ))}
      </div>
    </section>
  )
}

/** Local security checkup for weak, reused, and HTTP logins, with on-demand HIBP breach checks. */
export function SecurityView({
  onBack,
  onOpenLogin,
}: {
  onBack: () => void
  onOpenLogin: (vault: VaultInfo, login: LoginSummary) => void
}) {
  const { data: report, error } = useBackgroundQuery(
    "popup.securityAudit",
    null,
    { onError: notifyError },
  )

  const totalIssues = report
    ? report.weak.length + report.reused.length + report.insecureHttp.length
    : 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BackHeader title={t("popup.security.title")} onBack={onBack} />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-canvas p-3">
        {!report && !error && (
          <div role="status" className="flex flex-col gap-2">
            <span className="sr-only">{t("common.loading")}</span>
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        )}
        {report && (
          <div className={cn("flex flex-col gap-3", FADE_IN)}>
            <div className="grid grid-cols-3 gap-2">
              <div className="flex flex-col items-center gap-0.5 rounded-xl border border-border/80 bg-card p-2.5 text-center shadow-2xs">
                <KeyRoundIcon className="size-4 text-muted-foreground" />
                <span className="text-base font-semibold tabular-nums">
                  {report.weak.length}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {t("popup.security.weak")}
                </span>
              </div>
              <div className="flex flex-col items-center gap-0.5 rounded-xl border border-border/80 bg-card p-2.5 text-center shadow-2xs">
                <Repeat2Icon className="size-4 text-muted-foreground" />
                <span className="text-base font-semibold tabular-nums">
                  {report.reused.length}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {t("popup.security.reused")}
                </span>
              </div>
              <div className="flex flex-col items-center gap-0.5 rounded-xl border border-border/80 bg-card p-2.5 text-center shadow-2xs">
                <GlobeLockIcon className="size-4 text-muted-foreground" />
                <span className="text-base font-semibold tabular-nums">
                  {report.insecureHttp.length}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {t("popup.security.insecureHttp")}
                </span>
              </div>
            </div>
            <p className="px-1 text-xs text-muted-foreground">
              {t("popup.security.hibpHint")}
            </p>
            {totalIssues === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-border/80 bg-card px-4 py-6 text-center shadow-2xs">
                <CheckCircle2Icon className="size-7 text-emerald-600" />
                <p className="text-sm font-medium">
                  {t("popup.security.allClear")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("popup.security.checkedCount", {
                    count: report.totalChecked,
                  })}
                </p>
              </div>
            ) : (
              <>
                <AuditSection
                  title={t("popup.security.weak")}
                  findings={report.weak}
                  onOpen={onOpenLogin}
                />
                <AuditSection
                  title={t("popup.security.reused")}
                  findings={report.reused}
                  badgeOf={(finding) =>
                    t("popup.security.reusedTimes", {
                      count: finding.reuseCount ?? 2,
                    })
                  }
                  onOpen={onOpenLogin}
                />
                <AuditSection
                  title={t("popup.security.insecureHttp")}
                  findings={report.insecureHttp}
                  onOpen={onOpenLogin}
                />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

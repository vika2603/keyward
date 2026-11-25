import { CheckIcon } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { type BackgroundApi, callBackground } from "@/background/api"
import { BrandIcon, sourceLabel } from "@/components/keyward/brand-icon"
import { errorMessage } from "@/components/keyward/errors"
import { FADE_IN, LoginListSkeleton } from "@/components/keyward/loading"
import { LoginLabel } from "@/components/keyward/login-label"
import { SiteIcon } from "@/components/keyward/site-icon"
import { Button } from "@/components/ui/button"
import { APPLE_SOURCE_ID } from "@/lib/backends/apple/source-id"
import type { LoginSummary, SourceInfo } from "@/lib/backends/types"
import { t } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { LockedSourceCard } from "./connect-card"
import { BackHeader } from "./header"

type Setup = BackgroundApi["popup.codeSetup"]["result"]

/** A place the key can go: the Passwords app, or a Bitwarden login. */
interface Choice {
  sourceId: string
  loginId?: string
  name: string
}

function choiceId(choice: Choice): string {
  return `${choice.sourceId}\n${choice.loginId ?? ""}`
}

function Group({
  icon,
  title,
  children,
}: {
  icon: ReactNode
  title: string
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-1">
      <h2 className="flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground">
        {icon}
        <span className="min-w-0 truncate">{title}</span>
      </h2>
      <div className="rounded-xl bg-card ring-1 ring-foreground/10">
        {children}
      </div>
    </section>
  )
}

/**
 * Where an authenticator key picked from a page goes: the Passwords app, which asks on the Mac
 * which login gets it, or a Bitwarden login of the site. The key itself stays in the background.
 */
export function CodeSetupView({
  onBack,
  onConnect,
}: {
  onBack: () => void
  /** Pairs or unlocks a source, then comes back here; the key waits in the background. */
  onConnect: (source: SourceInfo) => void
}) {
  const [setup, setSetup] = useState<Setup | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  /** The choice waiting for a second click, because it replaces a login's current code. */
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<Choice | null>(null)

  useEffect(() => {
    callBackground("popup.codeSetup", null).then(setSetup, (error) =>
      setMessage(errorMessage(error)),
    )
  }, [])

  const choose = async (choice: Choice, replaces: boolean) => {
    const id = choiceId(choice)
    if (replaces && confirming !== id) {
      setConfirming(id)
      return
    }
    setBusy(id)
    setMessage(null)
    try {
      await callBackground("popup.setUpCode", {
        sourceId: choice.sourceId,
        loginId: choice.loginId,
      })
      setDone(choice)
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setBusy(null)
      setConfirming(null)
    }
  }

  const loginRow = (sourceId: string, login: LoginSummary) => {
    const choice = {
      sourceId,
      loginId: login.id,
      name: login.username || login.title,
    }
    const id = choiceId(choice)
    const replaces = login.hasCode === true
    return (
      <div
        key={login.id}
        className="flex flex-col gap-1 border-t px-2 py-1.5 first:border-t-0"
      >
        <div className="flex min-h-10 items-center gap-2.5">
          <SiteIcon host={login.host} text={login.title} />
          <LoginLabel
            username={login.username}
            detail={replaces ? t("popup.codeSetup.hasCode") : login.title}
            compact={false}
          />
          <Button
            size="sm"
            variant={confirming === id ? "destructive" : "outline"}
            disabled={busy !== null}
            onClick={() => void choose(choice, replaces)}
          >
            {confirming === id
              ? t("popup.codeSetup.confirmReplace")
              : replaces
                ? t("popup.codeSetup.replace")
                : t("popup.codeSetup.add")}
          </Button>
        </div>
        {confirming === id && (
          <p className="pb-1 pl-[42px] text-xs text-muted-foreground">
            {t("popup.codeSetup.replaceHint")}
          </p>
        )}
      </div>
    )
  }

  const label = [setup?.issuer, setup?.account].filter(Boolean).join(" · ")
  const empty = setup !== null && !setup.apple && setup.sources.length === 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BackHeader title={t("popup.codeSetup.title")} onBack={onBack} />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-3">
        {setup && (
          <div className={cn("flex items-center gap-3 px-1", FADE_IN)}>
            <SiteIcon
              host={setup.host}
              text={setup.issuer ?? setup.host}
              className="size-10"
            />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-sm font-medium">
                {label || setup.host}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {t("popup.codeSetup.from", { host: setup.host })}
              </span>
            </div>
          </div>
        )}
        {message && <p className="px-1 text-xs text-destructive">{message}</p>}
        {!setup && !message && (
          <LoginListSkeleton compact={false} heading={false} />
        )}
        {done ? (
          <div
            className={cn(
              "flex flex-col items-center gap-3 py-6 text-center",
              FADE_IN,
            )}
          >
            <span className="flex size-10 items-center justify-center rounded-full bg-muted">
              <CheckIcon className="size-5" />
            </span>
            <p className="text-sm">
              {done.sourceId === APPLE_SOURCE_ID
                ? t("popup.codeSetup.appleOpened")
                : t("popup.codeSetup.added", { name: done.name })}
            </p>
            <Button variant="outline" onClick={() => window.close()}>
              {t("popup.codeSetup.done")}
            </Button>
          </div>
        ) : (
          setup && (
            <div className={cn("flex flex-col gap-3", FADE_IN)}>
              {empty && (
                <p className="px-1 text-sm text-muted-foreground">
                  {t("popup.codeSetup.noTarget")}
                </p>
              )}
              {setup.apple && (
                <Group
                  icon={<BrandIcon kind="apple" className="size-3.5" />}
                  title={t("common.applePasswords")}
                >
                  <div className="flex min-h-12 items-center gap-2.5 px-3 py-2">
                    <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                      {t("popup.codeSetup.apple")}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() =>
                        void choose(
                          {
                            sourceId: APPLE_SOURCE_ID,
                            name: t("common.applePasswords"),
                          },
                          false,
                        )
                      }
                    >
                      {t("popup.codeSetup.add")}
                    </Button>
                  </div>
                </Group>
              )}
              {setup.sources.map((source) => (
                <Group
                  key={source.id}
                  icon={<BrandIcon kind={source.kind} className="size-3.5" />}
                  title={sourceLabel(source)}
                >
                  {source.logins.length ? (
                    source.logins.map((login) => loginRow(source.id, login))
                  ) : (
                    <p className="px-3 py-3 text-xs text-muted-foreground">
                      {t("popup.codeSetup.noLogins", { host: setup.host })}
                    </p>
                  )}
                </Group>
              ))}
              {setup.locked.map((source) => (
                <LockedSourceCard
                  key={source.id}
                  source={source}
                  onClick={() => onConnect(source)}
                />
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}

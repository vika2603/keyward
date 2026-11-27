import { LoaderCircleIcon, TriangleAlertIcon } from "lucide-react"
import { useEffect, useState } from "react"
import {
  type HttpAuthView as Challenge,
  callBackground,
  HTTP_AUTH_PORT,
  type VaultView,
} from "@/background/api"
import { BrandIcon, vaultLabel } from "@/components/keyward/brand-icon"
import { notifyError } from "@/components/keyward/notify"
import { SiteIcon } from "@/components/keyward/site-icon"
import { Button } from "@/components/ui/button"
import { t } from "@/lib/i18n"
import { waitsForUser } from "@/lib/offered-vaults"
import type { LoginSummary } from "@/lib/providers/types"
import { LockedVaultCard } from "./connect-card"
import { closeIfPopup, holdPopupPort } from "./pop-out"

/**
 * The logins of a site that asks for one through the browser's own sign-in dialog, as a router's
 * admin page does. Choosing one signs in; the browser's dialog stays available.
 */
export function HttpAuthView({
  onConnect,
}: {
  onConnect: (vault: VaultView) => void
}) {
  /** Undefined while it loads, null once the site stopped asking. */
  const [challenge, setChallenge] = useState<Challenge | null>()
  /** The login being read and sent. */
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    holdPopupPort(HTTP_AUTH_PORT)
    callBackground("popup.httpAuth", null).then(setChallenge, (error) => {
      notifyError(error)
      setChallenge(null)
    })
  }, [])

  const choose = async (vault: VaultView, login: LoginSummary) => {
    setBusy(login.id)
    try {
      await callBackground("popup.answerHttpAuth", {
        vaultId: vault.id,
        loginId: login.id,
      })
      closeIfPopup()
    } catch (error) {
      notifyError(error)
    } finally {
      setBusy(null)
    }
  }

  const leaveToBrowser = () => {
    void callBackground("popup.declineHttpAuth", null)
      .catch(() => {})
      .finally(closeIfPopup)
  }

  if (challenge === undefined) return null
  if (challenge === null)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
        <p className="text-sm text-muted-foreground">
          {t("popup.httpAuth.gone")}
        </p>
        <Button variant="outline" onClick={closeIfPopup}>
          {t("common.close")}
        </Button>
      </div>
    )

  const headed = challenge.vaults.length > 1
  const busyVault = challenge.vaults.find((vault) =>
    vault.logins.some((login) => login.id === busy),
  )
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-col gap-2 px-5 pt-6 pb-4">
        <h1 className="text-base leading-6 font-semibold tracking-tight break-all">
          {t("popup.httpAuth.title", { host: challenge.host })}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("popup.httpAuth.description")}
        </p>
        {!challenge.encrypted && (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <TriangleAlertIcon
              aria-hidden="true"
              className="mt-px size-3.5 shrink-0"
            />
            {t("popup.httpAuth.unencrypted")}
          </p>
        )}
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3">
        {challenge.vaults.map((vault) =>
          waitsForUser(vault) ? (
            <LockedVaultCard
              key={vault.id}
              vault={vault}
              onClick={() => onConnect(vault)}
            />
          ) : (
            <section key={vault.id} aria-label={vaultLabel(vault)}>
              {headed && (
                <h2 className="flex items-center gap-1.5 px-2 pt-1 pb-1 text-xs font-medium text-muted-foreground">
                  <BrandIcon kind={vault.kind} className="size-3.5" />
                  <span className="truncate">{vaultLabel(vault)}</span>
                </h2>
              )}
              {vault.status !== "ready" || vault.error ? (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">
                  {vault.status === "ready"
                    ? t("vault.failed")
                    : t("vault.unavailable")}
                </p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {vault.logins.map((login) => (
                    <button
                      key={login.id}
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void choose(vault, login)}
                      className="group/row flex min-h-12 w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-muted focus-visible:bg-muted disabled:cursor-wait"
                    >
                      <SiteIcon
                        host={login.host}
                        text={login.title}
                        className="group-hover/row:bg-background group-focus-visible/row:bg-background"
                      />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium">
                          {login.username || t("common.noUsername")}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {login.title}
                        </span>
                      </span>
                      {busy === login.id && (
                        <LoaderCircleIcon className="size-4 shrink-0 animate-spin text-muted-foreground" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </section>
          ),
        )}
        {busyVault?.kind === "apple" && (
          <p className="px-2 text-xs text-muted-foreground">
            {t("popup.main.confirmTouchId")}
          </p>
        )}
      </div>
      <footer className="border-t border-border/70 p-3">
        <Button variant="outline" className="w-full" onClick={leaveToBrowser}>
          {t("popup.httpAuth.browserDialog")}
        </Button>
      </footer>
    </div>
  )
}

import { useState } from "react"
import { callBackground } from "@/background/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAsyncAction } from "@/hooks/use-async-action"
import { useBackgroundQuery } from "@/hooks/use-background-query"
import { t } from "@/lib/i18n"
import { serverHost } from "@/lib/providers/bitwarden/server"
import { cn } from "@/lib/utils"
import { BrandIcon } from "./brand-icon"
import { errorMessage } from "./errors"
import { FADE_IN, FieldsSkeleton } from "./loading"
import { VaultSelect } from "./vault-select"

/**
 * Unlocks signed-in accounts one at a time with their master passwords. An unlocked account stays
 * unlocked while another one is chosen.
 */
export function BitwardenUnlock({
  initialAccountId,
  onUnlocked,
  onSignIn,
}: {
  initialAccountId?: string
  onUnlocked: () => void
  onSignIn: () => void
}) {
  const { data: accounts, error: loadError } = useBackgroundQuery(
    "bitwarden.accounts",
    null,
  )
  const [chosenId, setChosenId] = useState(initialAccountId)
  const [password, setPassword] = useState("")
  const { busy, message, setMessage, run } = useAsyncAction()

  // Without its accounts the view has nothing else to show, so the error takes the form's place.
  if (!accounts) {
    return loadError ? (
      <p className="text-center text-xs text-destructive">
        {errorMessage(loadError)}
      </p>
    ) : (
      <FieldsSkeleton rows={2} />
    )
  }
  if (!accounts.length) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex size-11 items-center justify-center rounded-xl bg-muted">
          <BrandIcon kind="bitwarden" className="size-6" />
        </div>
        <p className="text-sm text-muted-foreground">{t("unlock.noAccount")}</p>
        <Button size="lg" className="w-full" onClick={onSignIn}>
          {t("unlock.signIn")}
        </Button>
      </div>
    )
  }

  // The account asked for, else the first one still locked.
  const account =
    accounts.find((candidate) => candidate.id === chosenId) ??
    accounts.find((candidate) => !candidate.unlocked) ??
    accounts[0]
  // The same email can have an account on several servers; the server tells them apart. A label
  // that already ends with the server, as for accounts sharing an email, needs no second line.
  const host = account && serverHost(account.server)
  const server = account && host && !account.label.endsWith(host) && (
    <p className="max-w-full truncate text-xs text-muted-foreground">
      {t("unlock.server", { host })}
    </p>
  )
  const unlock = async () => {
    if (!account || busy) return
    if (!password) {
      setMessage(t("unlock.enterPassword"))
      return
    }
    const unlocked = await run(() =>
      callBackground("bitwarden.unlock", { accountId: account.id, password }),
    )
    if (!unlocked) return
    setPassword("")
    onUnlocked()
  }

  return (
    <div
      className={cn("flex flex-col items-center gap-4 text-center", FADE_IN)}
    >
      <div className="flex min-w-0 flex-col items-center gap-2">
        <div className="mb-1 flex size-11 items-center justify-center rounded-xl bg-muted">
          <BrandIcon kind="bitwarden" className="size-6" />
        </div>
        <h2 className="text-base font-medium">{t("unlock.title")}</h2>
        {accounts.length === 1 && account && (
          <div className="flex max-w-full flex-col items-center gap-0.5">
            <p className="max-w-full truncate text-sm text-muted-foreground">
              {account.label}
            </p>
            {server}
          </div>
        )}
      </div>
      {accounts.length > 1 && (
        <VaultSelect
          vaults={accounts.map((candidate) => ({
            id: candidate.id,
            kind: "bitwarden",
            label: candidate.label,
            status: candidate.unlocked ? "ready" : "locked",
          }))}
          value={account?.id ?? null}
          onChange={(id) => {
            setChosenId(id)
            setPassword("")
            setMessage(null)
          }}
          label={t("unlock.accountLabel")}
        />
      )}
      {accounts.length > 1 && server}
      {account && !account.unlocked && (
        <form
          className="flex w-full flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void unlock()
          }}
        >
          <Input
            type="password"
            autoComplete="current-password"
            placeholder={t("unlock.masterPassword")}
            aria-label={t("unlock.masterPassword")}
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="h-9"
          />
          {message && <p className="text-xs text-destructive">{message}</p>}
          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy ? t("unlock.busy") : t("unlock.unlock")}
          </Button>
        </form>
      )}
      {account?.unlocked && (
        <p className="text-sm text-muted-foreground">
          {t("unlock.alreadyUnlocked")}
        </p>
      )}
    </div>
  )
}

import { useEffect, useState } from "react"
import { callBackground } from "@/background/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { t } from "@/lib/i18n"
import type { AccountSummary } from "@/lib/providers/bitwarden/bitwarden-provider"
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
  const [accounts, setAccounts] = useState<AccountSummary[] | null>(null)
  const [selected, setSelected] = useState<string | undefined>(initialAccountId)
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    void callBackground("bitwarden.accounts", null).then((list) => {
      setAccounts(list)
      setSelected((current) =>
        list.some((a) => a.id === current)
          ? current
          : (list.find((a) => !a.unlocked) ?? list[0])?.id,
      )
    })
  }, [])

  if (!accounts) return <FieldsSkeleton rows={2} />
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

  const account = accounts.find((a) => a.id === selected)
  const unlock = async () => {
    if (!account || busy) return
    if (!password) {
      setMessage(t("unlock.enterPassword"))
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      await callBackground("bitwarden.unlock", {
        accountId: account.id,
        password,
      })
      setPassword("")
      onUnlocked()
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setBusy(false)
    }
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
          <p className="max-w-full truncate text-sm text-muted-foreground">
            {account.email}
          </p>
        )}
      </div>
      {accounts.length > 1 && (
        <VaultSelect
          vaults={accounts.map((a) => ({
            id: a.id,
            kind: "bitwarden",
            label: a.email,
            status: a.unlocked ? "ready" : "locked",
          }))}
          value={selected ?? null}
          onChange={(id) => {
            setSelected(id)
            setPassword("")
            setMessage(null)
          }}
          label={t("unlock.accountLabel")}
        />
      )}
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

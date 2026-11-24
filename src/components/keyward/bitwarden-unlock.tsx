import { useEffect, useState } from "react"
import { callBackground } from "@/background/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { AccountSummary } from "@/lib/backends/bitwarden/bitwarden-backend"
import { cn } from "@/lib/utils"
import { errorMessage } from "./errors"

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

  if (!accounts) return null
  if (!accounts.length) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-muted-foreground">
          还没有登录 Bitwarden 账号。
        </p>
        <Button onClick={onSignIn}>登录</Button>
      </div>
    )
  }

  const account = accounts.find((a) => a.id === selected)
  const unlock = async () => {
    if (!account || !password) return
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
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <span className="text-sm leading-none font-medium">账号</span>
        <fieldset
          aria-label="要解锁的账号"
          className="flex min-w-0 flex-col gap-0.5"
        >
          {accounts.map((a) => (
            <label
              key={a.id}
              className={cn(
                "flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-muted has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                a.id === selected && "bg-muted",
              )}
            >
              <input
                type="radio"
                name="account"
                className="sr-only"
                checked={a.id === selected}
                onChange={() => {
                  setSelected(a.id)
                  setMessage(null)
                }}
              />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {a.email}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {a.unlocked ? "已解锁" : "未解锁"}
              </span>
            </label>
          ))}
        </fieldset>
      </div>
      {account && !account.unlocked && (
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void unlock()
          }}
        >
          <label className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="text-sm leading-none font-medium">主密码</span>
            <Input
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <Button type="submit" disabled={busy || !password}>
            解锁
          </Button>
        </form>
      )}
      {account?.unlocked && (
        <p className="text-xs text-muted-foreground">
          这个账号已解锁。切换到其他账号不会让它重新锁定。
        </p>
      )}
      {message && <p className="text-xs text-destructive">{message}</p>}
    </div>
  )
}

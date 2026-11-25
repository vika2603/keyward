import {
  ExternalLinkIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
} from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { callBackground } from "@/background/api"
import { BrandIcon, providerName } from "@/components/keyward/brand-icon"
import { errorMessage } from "@/components/keyward/errors"
import { VaultSelect } from "@/components/keyward/vault-select"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { currentLanguage, t } from "@/lib/i18n"
import { APPLE_VAULT_ID } from "@/lib/providers/apple/vault-id"
import type { AccountSummary } from "@/lib/providers/bitwarden/bitwarden-provider"
import { isCloudServer, serverHost } from "@/lib/providers/bitwarden/server"
import type { VaultInfo } from "@/lib/providers/types"
import { cn } from "@/lib/utils"
import { navigate } from "./App"
import { Card, Option, PageHeader, Section } from "./parts"
import { useSettings } from "./use-settings"

function lockTimes(): [string, string][] {
  return [
    ["1", t("options.duration.oneMinute")],
    ["5", t("options.duration.minutes", { count: 5 })],
    ["15", t("options.duration.minutes", { count: 15 })],
    ["30", t("options.duration.minutes", { count: 30 })],
    ["60", t("options.duration.oneHour")],
    ["240", t("options.duration.hours", { count: 4 })],
    ["never", t("options.vaults.autoLock.onQuit")],
  ]
}

export function VaultsPage() {
  const [settings, update] = useSettings()
  const [accounts, setAccounts] = useState<AccountSummary[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<AccountSummary | null>(null)
  /** The account being synced now. */
  const [syncing, setSyncing] = useState<string | null>(null)
  /** Why loading, syncing or signing out the Bitwarden accounts failed. */
  const [accountsMessage, setAccountsMessage] = useState<string | null>(null)

  const load = useCallback(() => {
    callBackground("bitwarden.accounts", null).then(setAccounts, (error) =>
      setAccountsMessage(errorMessage(error)),
    )
  }, [])
  useEffect(load, [load])

  if (!settings) return null

  const signOut = async (account: AccountSummary) => {
    if (
      !confirm(
        t("options.vaults.bitwarden.signOutConfirm", {
          email: account.label,
        }),
      )
    )
      return
    setAccountsMessage(null)
    try {
      await callBackground("bitwarden.signOut", { accountId: account.id })
    } catch (error) {
      setAccountsMessage(errorMessage(error))
    }
    load()
  }

  const syncNow = async (account: AccountSummary) => {
    setSyncing(account.id)
    setAccountsMessage(null)
    try {
      await callBackground("bitwarden.sync", { accountId: account.id })
    } catch (error) {
      setAccountsMessage(errorMessage(error))
    } finally {
      setSyncing(null)
      load()
    }
  }

  const openApp = async () => {
    setMessage(null)
    try {
      await callBackground("apple.openPasswordsApp", {})
    } catch (error) {
      setMessage(errorMessage(error))
    }
  }

  const targets: VaultInfo[] = [
    ...(settings.appleEnabled
      ? [
          {
            id: APPLE_VAULT_ID,
            kind: "apple" as const,
            label: providerName("apple"),
            status: "ready" as const,
          },
        ]
      : []),
    ...accounts.map((account) => ({
      id: account.vaultId,
      kind: "bitwarden" as const,
      label: account.label,
      status: "ready" as const,
    })),
  ]
  const defaultTarget =
    targets.find((target) => target.id === settings.defaultSaveTarget)?.id ??
    targets[0]?.id ??
    null

  return (
    <>
      <PageHeader
        title={t("options.vaults.title")}
        description={t("options.vaults.description")}
      />
      <Card>
        <Option
          name={
            <span className="flex items-center gap-2.5">
              <BrandIcon kind="apple" />
              {providerName("apple")}
            </span>
          }
          description={t("options.vaults.apple.description")}
        >
          <Switch
            aria-label={t("options.vaults.apple.toggle")}
            checked={settings.appleEnabled}
            onCheckedChange={(checked) => update({ appleEnabled: checked })}
          />
        </Option>
        {settings.appleEnabled && (
          <Option
            name={t("options.vaults.apple.actions.name")}
            description={t("options.vaults.apple.actions.description")}
          >
            <Button variant="outline" onClick={() => void openApp()}>
              <ExternalLinkIcon />
              {t("options.vaults.apple.openApp")}
            </Button>
          </Option>
        )}
        {message && (
          <p className="px-4 pb-3 text-sm text-destructive">{message}</p>
        )}
      </Card>
      <Card>
        <Option
          name={
            <span className="flex items-center gap-2.5">
              <BrandIcon kind="bitwarden" />
              {providerName("bitwarden")}
            </span>
          }
          description={
            accounts.length
              ? t("options.vaults.bitwarden.signedInDescription")
              : t("options.vaults.bitwarden.signedOutDescription")
          }
        >
          {accounts.length ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("onboard")}
            >
              <PlusIcon />
              {t("options.vaults.bitwarden.addAccount")}
            </Button>
          ) : (
            <Button size="sm" onClick={() => navigate("onboard")}>
              {t("options.vaults.bitwarden.signIn")}
            </Button>
          )}
        </Option>
        {accounts.map((account) => (
          <Option
            key={account.id}
            name={account.label}
            description={accountDetail(account)}
          >
            <div className="flex gap-1.5">
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("options.vaults.bitwarden.syncNow")}
                title={
                  account.unlocked
                    ? t("options.vaults.bitwarden.syncNow")
                    : t("options.vaults.bitwarden.syncLocked")
                }
                disabled={!account.unlocked || syncing !== null}
                onClick={() => void syncNow(account)}
              >
                <RefreshCwIcon
                  className={cn(syncing === account.id && "animate-spin")}
                />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("options.vaults.bitwarden.rename")}
                title={t("options.vaults.bitwarden.rename")}
                onClick={() => setRenaming(account)}
              >
                <PencilIcon />
              </Button>
              <Button variant="outline" onClick={() => void signOut(account)}>
                {t("options.vaults.bitwarden.signOut")}
              </Button>
            </div>
          </Option>
        ))}
        {accountsMessage && (
          <p className="px-4 pb-3 text-sm text-destructive">
            {accountsMessage}
          </p>
        )}
        {accounts.length > 0 && (
          <Option
            name={t("options.vaults.autoLock.name")}
            description={t("options.vaults.autoLock.description")}
          >
            <Select
              value={
                settings.autoLockMinutes === null
                  ? "never"
                  : String(settings.autoLockMinutes)
              }
              onValueChange={(value) =>
                update({
                  autoLockMinutes: value === "never" ? null : Number(value),
                })
              }
              items={lockTimes().map(([value, label]) => ({ value, label }))}
            >
              <SelectTrigger aria-label={t("options.vaults.autoLock.label")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {lockTimes().map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Option>
        )}
        {accounts.length > 0 && (
          <Option
            name={t("options.vaults.lockOnSystemLock.name")}
            description={t("options.vaults.lockOnSystemLock.description")}
          >
            <Switch
              aria-label={t("options.vaults.lockOnSystemLock.name")}
              checked={settings.lockOnSystemLock}
              onCheckedChange={(checked) =>
                update({ lockOnSystemLock: checked })
              }
            />
          </Option>
        )}
      </Card>
      {targets.length > 0 && (
        <Section title={t("options.vaults.saveTarget.title")}>
          <Card>
            <Option
              name={t("options.vaults.saveTarget.name")}
              description={t("options.vaults.saveTarget.description")}
            >
              <div className="w-64 max-w-full">
                <VaultSelect
                  vaults={targets}
                  value={defaultTarget}
                  onChange={(id) => update({ defaultSaveTarget: id })}
                  label={t("options.vaults.saveTarget.name")}
                />
              </div>
            </Option>
          </Card>
        </Section>
      )}
      <RenameDialog
        account={renaming}
        onClose={() => setRenaming(null)}
        onRenamed={load}
      />
    </>
  )
}

/**
 * Under an account's name: its server, its email address once the account has a name, and when it
 * last synced while it is unlocked.
 */
function accountDetail(account: AccountSummary): string {
  // A self-hosted server keeps its path, which may tell two servers on one host apart.
  const server = isCloudServer(account.server)
    ? serverHost(account.server)
    : account.server.replace(/^https:\/\//, "")
  const parts = account.name ? [account.email, server] : [server]
  if (account.unlocked && account.syncedAt !== undefined)
    parts.push(
      t("options.vaults.bitwarden.syncedAt", {
        time: new Date(account.syncedAt).toLocaleTimeString(currentLanguage(), {
          timeStyle: "short",
        }),
      }),
    )
  return parts.join(" · ")
}

function RenameDialog({
  account,
  onClose,
  onRenamed,
}: {
  account: AccountSummary | null
  onClose: () => void
  onRenamed: () => void
}) {
  const [name, setName] = useState("")
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    setName(account?.name ?? "")
    setMessage(null)
  }, [account])

  const save = async () => {
    if (!account) return
    try {
      await callBackground("bitwarden.renameAccount", {
        accountId: account.id,
        name,
      })
      onRenamed()
      onClose()
    } catch (error) {
      setMessage(errorMessage(error))
    }
  }

  return (
    <Dialog open={account !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {t("options.vaults.bitwarden.renameTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("options.vaults.bitwarden.renameDescription")}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={account?.email}
            aria-label={t("options.vaults.bitwarden.nameLabel")}
            maxLength={100}
            autoFocus
          />
          {message && <p className="text-sm text-destructive">{message}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("options.vaults.bitwarden.cancel")}
            </Button>
            <Button type="submit">{t("options.vaults.bitwarden.save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

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
import {
  BrowserSelect,
  CommandBox,
  pageBrowser,
} from "@/components/keyward/setup-commands"
import { VaultSelect } from "@/components/keyward/vault-select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
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
import { Switch } from "@/components/ui/switch"
import { openConnectPasswords } from "@/lib/connect-passwords"
import { currentLanguage, t } from "@/lib/i18n"
import { isSetupProblem } from "@/lib/providers/apple/helper-port"
import { removalCommand } from "@/lib/providers/apple/setup-command"
import { APPLE_VAULT_ID } from "@/lib/providers/apple/vault-id"
import type { AccountSummary } from "@/lib/providers/bitwarden/bitwarden-provider"
import { isCloudServer, serverHost } from "@/lib/providers/bitwarden/server"
import type { VaultInfo } from "@/lib/providers/types"
import { AUTO_LOCK_MINUTES, type AutoLockMinutes } from "@/lib/settings"
import { cn } from "@/lib/utils"
import { navigate } from "./navigation"
import {
  Card,
  ChoiceSelect,
  Option,
  PageHeader,
  Section,
  useDialogOpening,
} from "./parts"
import { useSettings } from "./use-settings"

function lockTimes(): (readonly [AutoLockMinutes | "never", string])[] {
  const labels: Record<AutoLockMinutes, string> = {
    1: t("options.duration.oneMinute"),
    5: t("options.duration.minutes", { count: 5 }),
    15: t("options.duration.minutes", { count: 15 }),
    30: t("options.duration.minutes", { count: 30 }),
    60: t("options.duration.oneHour"),
    240: t("options.duration.hours", { count: 4 }),
  }
  return [
    ...AUTO_LOCK_MINUTES.map((minutes) => [minutes, labels[minutes]] as const),
    ["never", t("options.vaults.autoLock.onQuit")],
  ]
}

export function VaultsPage() {
  const [settings, update] = useSettings()
  const [accounts, setAccounts] = useState<AccountSummary[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<AccountSummary | null>(null)
  /** The account whose sign-out waits for confirmation. */
  const [signingOut, setSigningOut] = useState<AccountSummary | null>(null)
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

  /** Whether this Mac has the one-time setup for this browser; null until a check answers. */
  const [appleSetUp, setAppleSetUp] = useState<boolean | null>(null)
  const [removingSetup, setRemovingSetup] = useState(false)

  useEffect(() => {
    const check = () =>
      callBackground("apple.checkSetup", null).then(
        (answer) =>
          setAppleSetUp(answer.reached || !isSetupProblem(answer.problem)),
        // Without an answer the row keeps what it shows.
        () => {},
      )
    void check()
    // The setup gets done or removed in the connect page and in Terminal, behind this page.
    const checkWhenShown = () => {
      if (document.visibilityState === "visible") void check()
    }
    document.addEventListener("visibilitychange", checkWhenShown)
    return () =>
      document.removeEventListener("visibilitychange", checkWhenShown)
  }, [])

  if (!settings) return null

  // Passwords is set up before its switch can be turned on.
  const appleNeedsSetup = appleSetUp === false
  const appleSwitch = (
    <Switch
      aria-label={t("options.vaults.apple.toggle")}
      checked={settings.appleEnabled}
      disabled={appleSetUp === null && !settings.appleEnabled}
      onCheckedChange={(checked) => update({ appleEnabled: checked })}
    />
  )

  const signOut = async (account: AccountSummary) => {
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
          description={
            appleNeedsSetup
              ? t("options.vaults.apple.notSetUp")
              : t("options.vaults.apple.description")
          }
        >
          {appleNeedsSetup ? (
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                onClick={() => void openConnectPasswords()}
              >
                {t("options.vaults.apple.setUp")}
              </Button>
              {/* On, yet the setup is gone: it can still be turned off. */}
              {settings.appleEnabled && appleSwitch}
            </div>
          ) : (
            appleSwitch
          )}
        </Option>
        {settings.appleEnabled && !appleNeedsSetup && (
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
        {appleSetUp && (
          <Option
            name={t("options.vaults.apple.thisMac.name")}
            description={t("options.vaults.apple.thisMac.description")}
          >
            <Button variant="outline" onClick={() => setRemovingSetup(true)}>
              {t("options.vaults.apple.thisMac.remove")}
            </Button>
          </Option>
        )}
        {message && (
          <p className="px-4 pb-3 text-sm text-destructive">{message}</p>
        )}
      </Card>
      <RemoveSetupDialog
        open={removingSetup}
        onClose={() => setRemovingSetup(false)}
      />
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
              <Button variant="outline" onClick={() => setSigningOut(account)}>
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
            <ChoiceSelect
              names={lockTimes()}
              value={settings.autoLockMinutes ?? "never"}
              onChange={(minutes) =>
                update({
                  autoLockMinutes: minutes === "never" ? null : minutes,
                })
              }
              label={t("options.vaults.autoLock.label")}
            />
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
      <SignOutDialog
        account={signingOut}
        onClose={() => setSigningOut(null)}
        onConfirm={(account) => void signOut(account)}
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
  const opened = useDialogOpening(account, (opening) => {
    setName(opening.name ?? "")
    setMessage(null)
  })

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
            placeholder={opened?.email}
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

/** Asks before an account signs out, as signing in again needs the master password and second step. */
function SignOutDialog({
  account,
  onClose,
  onConfirm,
}: {
  account: AccountSummary | null
  onClose: () => void
  onConfirm: (account: AccountSummary) => void
}) {
  const opened = useDialogOpening(account)
  return (
    <AlertDialog
      open={account !== null}
      onOpenChange={(open) => !open && onClose()}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("options.vaults.bitwarden.signOut")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("options.vaults.bitwarden.signOutConfirm", {
              email: opened?.label ?? "",
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>
            {t("options.vaults.bitwarden.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (account) onConfirm(account)
              onClose()
            }}
          >
            {t("options.vaults.bitwarden.signOut")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Shows the Terminal command that takes the one-time setup away from a browser. */
function RemoveSetupDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [targetBrowser, setTargetBrowser] = useState(pageBrowser)
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("options.vaults.apple.removal.title")}</DialogTitle>
          <DialogDescription>
            {t("options.vaults.apple.removal.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <BrowserSelect value={targetBrowser} onChange={setTargetBrowser} />
          <CommandBox command={removalCommand(targetBrowser)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

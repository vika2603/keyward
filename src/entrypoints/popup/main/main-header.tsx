import {
  LockIcon,
  PlusIcon,
  RefreshCcwDotIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
} from "lucide-react"
import keywardIcon from "@/assets/icon.svg"
import { Button } from "@/components/ui/button"
import { t } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { SettingsButton } from "../header"

/** The main view's title, with the buttons that add a login, generate, audit, sync, lock all and open settings. */
export function MainHeader({
  syncShown,
  syncing,
  securityShown,
  lockShown,
  lockEnabled,
  onAdd,
  onGenerator,
  onSecurity,
  onSync,
  onLockAll,
}: {
  syncShown: boolean
  syncing: boolean
  securityShown: boolean
  lockShown: boolean
  lockEnabled: boolean
  onAdd: () => void
  onGenerator: () => void
  onSecurity: () => void
  onSync: () => void
  onLockAll: () => void
}) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-0.5 pr-2 pl-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <img
          src={keywardIcon}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="size-5 shrink-0"
        />
        <h1 className="min-w-0 truncate text-sm font-semibold tracking-tight">
          Keyward
        </h1>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground hover:text-foreground"
        aria-label={t("popup.main.add")}
        title={t("popup.main.add")}
        onClick={onAdd}
      >
        <PlusIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground hover:text-foreground"
        aria-label={t("popup.generator.title")}
        title={t("popup.generator.title")}
        onClick={onGenerator}
      >
        <RefreshCcwDotIcon />
      </Button>
      {securityShown && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
          aria-label={t("popup.security.title")}
          title={t("popup.security.title")}
          onClick={onSecurity}
        >
          <ShieldCheckIcon />
        </Button>
      )}
      {syncShown && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
          aria-label={t("popup.main.sync")}
          title={t("popup.main.sync")}
          disabled={syncing}
          onClick={onSync}
        >
          <RefreshCwIcon className={cn(syncing && "animate-spin")} />
        </Button>
      )}
      {/* Disabled rather than hidden once all is locked, so the buttons beside it stay put. */}
      {lockShown && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
          aria-label={t("popup.main.lockAll")}
          title={t("popup.main.lockAll")}
          disabled={!lockEnabled}
          onClick={onLockAll}
        >
          <LockIcon />
        </Button>
      )}
      <SettingsButton />
    </div>
  )
}

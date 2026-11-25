import { LockIcon, PlusIcon, RefreshCcwDotIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { t } from "@/lib/i18n"
import { SettingsButton } from "../header"

/** The main view's title, with the buttons that add a login, generate, lock all and open settings. */
export function MainHeader({
  lockShown,
  lockEnabled,
  onAdd,
  onGenerator,
  onLockAll,
}: {
  lockShown: boolean
  lockEnabled: boolean
  onAdd: () => void
  onGenerator: () => void
  onLockAll: () => void
}) {
  return (
    <div className="flex items-center gap-1 py-2 pr-2 pl-3">
      <h1 className="min-w-0 flex-1 truncate text-sm font-medium">Keyward</h1>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("popup.add.title")}
        title={t("popup.add.title")}
        onClick={onAdd}
      >
        <PlusIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("popup.generator.title")}
        title={t("popup.generator.title")}
        onClick={onGenerator}
      >
        <RefreshCcwDotIcon />
      </Button>
      {/* Disabled rather than hidden once all is locked, so the buttons beside it stay put. */}
      {lockShown && (
        <Button
          variant="ghost"
          size="icon"
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

import {
  ArchiveRestoreIcon,
  CheckIcon,
  CopyIcon,
  KeyRoundIcon,
  TimerIcon,
  Trash2Icon,
  UserIcon,
} from "lucide-react"
import { useState } from "react"
import { callBackground } from "@/background/api"
import { errorCodeOf } from "@/components/keyward/errors"
import { LoginLabel } from "@/components/keyward/login-label"
import { NoteIcon } from "@/components/keyward/note-icon"
import { notify, notifyError } from "@/components/keyward/notify"
import { SiteIcon } from "@/components/keyward/site-icon"
import { Button } from "@/components/ui/button"
import {
  COPIED_FEEDBACK_MS,
  useTransientValue,
} from "@/hooks/use-transient-value"
import { currentLanguage, t } from "@/lib/i18n"
import type {
  LoginSummary,
  NoteSummary,
  TrashedItem,
  VaultInfo,
} from "@/lib/providers/types"
import type { Settings } from "@/lib/settings"
import { cn } from "@/lib/utils"

/**
 * A login or note in the trash: restored from one button, deleted for good from another that asks
 * for a second click. Read-only items of an organization only say why they stay.
 */
export function TrashedRow({
  vault,
  item,
  density,
  onChanged,
}: {
  vault: VaultInfo
  item: TrashedItem
  density: Settings["density"]
  /** The item left the trash; the list loads again. */
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  /** The delete button was clicked once and waits for the second click. */
  const [armed, setArmed] = useState(false)
  const compact = density === "compact"
  const ids = { vaultId: vault.id, itemId: item.id }
  const detail = !item.editable
    ? t("popup.trash.readOnly")
    : item.deletedAt === undefined
      ? (item.username ?? "")
      : t("popup.trash.deletedOn", {
          date: new Intl.DateTimeFormat(currentLanguage(), {
            dateStyle: "medium",
          }).format(item.deletedAt),
        })

  const run = async (action: "restore" | "purge") => {
    setBusy(true)
    try {
      if (action === "restore") await callBackground("popup.restoreItem", ids)
      else await callBackground("popup.purgeItem", ids)
      notify(
        action === "restore"
          ? t("popup.trash.restored", { name: item.name })
          : t("popup.trash.purged", { name: item.name }),
      )
      onChanged()
    } catch (error) {
      notifyError(error)
    } finally {
      setBusy(false)
      setArmed(false)
    }
  }

  return (
    <div
      className={cn(
        "group/row flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-muted focus-within:bg-muted",
        compact ? "min-h-9" : "min-h-12",
      )}
    >
      {item.kind === "login" ? (
        <SiteIcon
          host={item.host}
          text={item.name}
          className={cn(
            "group-hover/row:bg-background group-focus-within/row:bg-background",
            compact && "size-6",
          )}
        />
      ) : (
        <NoteIcon
          className={cn(
            "group-hover/row:bg-background group-focus-within/row:bg-background",
            compact && "size-6",
          )}
        />
      )}
      <LoginLabel username={item.name} detail={detail} compact={compact} />
      {item.editable && (
        <div
          className={cn(
            "flex shrink-0 items-center gap-0.5 opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100",
            armed && "opacity-100",
          )}
        >
          {!armed && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="hover:bg-background"
              aria-label={t("popup.trash.restore")}
              title={t("popup.trash.restore")}
              disabled={busy}
              onClick={() => void run("restore")}
            >
              <ArchiveRestoreIcon />
            </Button>
          )}
          <Button
            variant={armed ? "destructive" : "ghost"}
            size={armed ? "sm" : "icon-sm"}
            className={cn(!armed && "hover:bg-background")}
            aria-label={t("popup.trash.purge")}
            title={t("popup.trash.purge")}
            disabled={busy}
            onClick={() => (armed ? void run("purge") : setArmed(true))}
            onBlur={() => setArmed(false)}
          >
            <Trash2Icon />
            {armed && t("popup.trash.confirmPurge")}
          </Button>
        </div>
      )}
    </div>
  )
}

/** A secure note in a list: opens on click, and copies its text from a button. */
export function NoteRow({
  vault,
  note,
  density,
  onOpen,
}: {
  vault: VaultInfo
  note: NoteSummary
  density: Settings["density"]
  onOpen: () => void
}) {
  const [copied, showCopied] = useTransientValue<true>(COPIED_FEEDBACK_MS)
  const compact = density === "compact"

  const copy = async () => {
    try {
      const details = await callBackground("popup.note", {
        vaultId: vault.id,
        noteId: note.id,
      })
      if (details.withheld) {
        notify(t("popup.note.withheld"))
        return
      }
      // An empty note has nothing to copy.
      if (!details.text) return
      await callBackground("popup.copyText", {
        text: details.text,
        secret: true,
      })
      showCopied(true)
    } catch (error) {
      notifyError(error)
    }
  }

  return (
    <div
      className={cn(
        "group/row flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-muted focus-within:bg-muted",
        compact ? "min-h-9" : "min-h-12",
      )}
    >
      <button
        type="button"
        title={t("popup.main.viewDetails")}
        data-row
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2.5 self-stretch text-left outline-none"
      >
        <NoteIcon
          className={cn(
            "group-hover/row:bg-background group-focus-within/row:bg-background",
            compact && "size-6",
          )}
        />
        <LoginLabel
          username={note.name}
          detail={t("popup.note.title")}
          compact={compact}
        />
      </button>
      <div className="flex shrink-0 gap-0.5 opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100">
        <Button
          variant="ghost"
          size="icon-sm"
          className="hover:bg-background"
          aria-label={t("popup.note.copy")}
          title={t("popup.note.copy")}
          onClick={() => void copy()}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </Button>
      </div>
    </div>
  )
}

type Copyable = "username" | "password" | "code"

export function LoginRow({
  vault,
  login,
  density,
  nameFirst = false,
  onOpen,
}: {
  vault: VaultInfo
  login: LoginSummary
  density: Settings["density"]
  /**
   * Shows the login's name above its username, as in a list sorted by name. A site's own list
   * shows the username first, since every login there is for the same site.
   */
  nameFirst?: boolean
  onOpen: () => void
}) {
  const [copied, showCopied] = useTransientValue<Copyable>(COPIED_FEEDBACK_MS)
  // Apple asks for Touch ID before it hands out a password; the row says so meanwhile.
  const [confirming, setConfirming] = useState(false)
  const compact = density === "compact"
  const ids = { vaultId: vault.id, loginId: login.id }
  const secondLine = nameFirst
    ? login.username || t("common.noUsername")
    : login.title

  const copy = async (what: Copyable) => {
    if (what === "password" && vault.kind === "apple") setConfirming(true)
    try {
      if (what === "username")
        await callBackground("popup.copyText", { text: login.username })
      else if (what === "password")
        await callBackground("popup.copyPassword", ids)
      else {
        const { code } = await callBackground("popup.oneTimeCode", ids)
        await callBackground("popup.copyText", { text: code, secret: true })
      }
      showCopied(what)
    } catch (error) {
      // The login's details ask for the master password, after which it can be copied.
      if (errorCodeOf(error) === "bitwarden.reprompt") onOpen()
      else notifyError(error)
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div
      className={cn(
        "group/row flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-muted focus-within:bg-muted",
        compact ? "min-h-9" : "min-h-12",
      )}
    >
      <button
        type="button"
        title={t("popup.main.viewDetails")}
        data-row
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2.5 self-stretch text-left outline-none"
      >
        <SiteIcon
          host={login.host}
          text={login.title}
          className={cn(
            "group-hover/row:bg-background group-focus-within/row:bg-background",
            compact && "size-6",
          )}
        />
        <LoginLabel
          username={nameFirst ? login.title : login.username}
          detail={confirming ? t("popup.main.confirmTouchId") : secondLine}
          compact={compact}
        />
      </button>
      <div
        className={cn(
          "flex shrink-0 gap-0.5 opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100",
          confirming && "opacity-100",
        )}
      >
        {login.username && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="hover:bg-background"
            aria-label={t("popup.copyUsername")}
            title={t("popup.copyUsername")}
            onClick={() => void copy("username")}
          >
            {copied === "username" ? <CheckIcon /> : <UserIcon />}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          className="hover:bg-background"
          aria-label={t("popup.copyPassword")}
          title={t("popup.copyPassword")}
          onClick={() => void copy("password")}
        >
          {copied === "password" ? <CheckIcon /> : <KeyRoundIcon />}
        </Button>
        {login.hasCode && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="hover:bg-background"
            aria-label={t("popup.copyCode")}
            title={t("popup.copyCode")}
            onClick={() => void copy("code")}
          >
            {copied === "code" ? <CheckIcon /> : <TimerIcon />}
          </Button>
        )}
      </div>
    </div>
  )
}

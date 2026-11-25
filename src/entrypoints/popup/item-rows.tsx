import {
  CheckIcon,
  CopyIcon,
  KeyRoundIcon,
  TimerIcon,
  UserIcon,
} from "lucide-react"
import { useState } from "react"
import { callBackground } from "@/background/api"
import { errorMessage } from "@/components/keyward/errors"
import { LoginLabel } from "@/components/keyward/login-label"
import { NoteIcon } from "@/components/keyward/note-icon"
import { SiteIcon } from "@/components/keyward/site-icon"
import { Button } from "@/components/ui/button"
import { t } from "@/lib/i18n"
import type {
  LoginSummary,
  NoteSummary,
  VaultInfo,
} from "@/lib/providers/types"
import type { Settings } from "@/lib/settings"
import { cn } from "@/lib/utils"

/** A secure note in a list: opens on click, and copies its text from a button. */
export function NoteRow({
  vault,
  note,
  density,
  onOpen,
  onError,
}: {
  vault: VaultInfo
  note: NoteSummary
  density: Settings["density"]
  onOpen: () => void
  onError: (message: string | null) => void
}) {
  const [copied, setCopied] = useState(false)
  const compact = density === "compact"

  const copy = async () => {
    onError(null)
    try {
      const details = await callBackground("popup.note", {
        vaultId: vault.id,
        noteId: note.id,
      })
      if (details.withheld) {
        onError(t("popup.note.withheld"))
        return
      }
      // An empty note has nothing to copy.
      if (!details.text) return
      await callBackground("popup.copyText", {
        text: details.text,
        secret: true,
      })
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (error) {
      onError(errorMessage(error))
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
  onError,
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
  onError: (message: string | null) => void
}) {
  const [copied, setCopied] = useState<Copyable | null>(null)
  // Apple asks for Touch ID before it hands out a password; the row says so meanwhile.
  const [confirming, setConfirming] = useState(false)
  const compact = density === "compact"
  const ids = { vaultId: vault.id, loginId: login.id }
  const secondLine = nameFirst
    ? login.username || t("common.noUsername")
    : login.title

  const copy = async (what: Copyable) => {
    onError(null)
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
      setCopied(what)
      setTimeout(() => setCopied(null), 1500)
    } catch (error) {
      onError(errorMessage(error))
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

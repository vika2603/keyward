import { CheckIcon, CopyIcon, EyeIcon, Trash2Icon } from "lucide-react"
import { useCallback, useMemo, useRef, useState } from "react"
import { callBackground, historyEntryOf } from "@/background/api"
import { useCopyThrough } from "@/components/keyward/copy-through"
import { notifyError } from "@/components/keyward/notify"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { useBackgroundQuery } from "@/hooks/use-background-query"
import {
  COPIED_FEEDBACK_MS,
  useTransientValue,
} from "@/hooks/use-transient-value"
import type { GeneratorKind } from "@/lib/generator"
import { currentLanguage, type MessageKey, t } from "@/lib/i18n"
import { BackHeader } from "./header"

/** Fixed length, so the mask does not reveal how long a password is. */
const MASK = "••••••••••••"

const COPY_LABELS: Record<GeneratorKind, MessageKey> = {
  password: "popup.history.copyPassword",
  passphrase: "popup.history.copyPassphrase",
  username: "popup.history.copyUsername",
}

function whenText(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60_000)
  const relative = new Intl.RelativeTimeFormat(currentLanguage(), {
    numeric: "auto",
  })
  if (minutes < 1) return t("popup.history.justNow")
  if (minutes < 60) return relative.format(-minutes, "minute")
  const hours = Math.round(minutes / 60)
  if (hours < 24) return relative.format(-hours, "hour")
  const days = Math.round(hours / 24)
  if (days < 2) return relative.format(-days, "day")
  return new Intl.DateTimeFormat(currentLanguage(), {
    month: "long",
    day: "numeric",
  }).format(at)
}

export function HistoryView({ onBack }: { onBack: () => void }) {
  const { data: received, update: updateEntries } = useBackgroundQuery(
    "history.list",
    null,
    { onError: notifyError },
  )
  // A background from before the kinds still sends entries in its own form until it reloads.
  const entries = useMemo(() => received?.map(historyEntryOf), [received])
  const [shown, setShown] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [copiedId, showCopied] = useTransientValue<string>(COPIED_FEEDBACK_MS)

  const copy = useCallback(
    async (id: string) => {
      try {
        await callBackground("history.copy", { id })
        showCopied(id)
      } catch (error) {
        notifyError(error)
      }
    },
    [showCopied],
  )
  const list = useRef<HTMLDivElement>(null)
  useCopyThrough(
    list,
    useCallback(
      (from: Element) => {
        const id = from.closest("[data-entry]")?.getAttribute("data-entry")
        if (id) void copy(id)
      },
      [copy],
    ),
  )

  const clear = async () => {
    try {
      await callBackground("history.clear", null)
      updateEntries(() => [])
    } catch (error) {
      notifyError(error)
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BackHeader title={t("popup.history.title")} onBack={onBack}>
        {confirming ? (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirming(false)}
            >
              {t("popup.cancel")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive"
              onClick={() => void clear()}
            >
              {t("popup.history.clearAll")}
            </Button>
          </div>
        ) : (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("popup.history.show")}
              title={t("popup.history.show")}
              aria-pressed={shown}
              className="aria-pressed:bg-muted"
              onClick={() => setShown(!shown)}
            >
              <EyeIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("popup.history.clear")}
              title={t("popup.history.clear")}
              disabled={!entries?.length}
              onClick={() => setConfirming(true)}
            >
              <Trash2Icon />
            </Button>
          </div>
        )}
      </BackHeader>
      <Separator />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {entries && !entries.length && (
          <p className="flex h-full items-center justify-center px-3 pb-12 text-center text-sm text-muted-foreground">
            {t("popup.history.empty")}
          </p>
        )}
        <div ref={list} className="flex flex-col gap-0.5 p-1">
          {entries?.map((entry) => {
            // Usernames are not secrets, so they show without the eye button.
            const visible = shown || entry.kind === "username"
            const copyLabel = t(COPY_LABELS[entry.kind])
            return (
              <div
                key={entry.id}
                className="group/row flex min-h-12 items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-muted focus-within:bg-muted"
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span
                    data-entry={visible ? entry.id : undefined}
                    className="truncate font-mono text-sm font-medium select-all"
                  >
                    {visible ? entry.value : MASK}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {[entry.host, whenText(entry.at)]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 hover:bg-background"
                  aria-label={copyLabel}
                  title={copyLabel}
                  onClick={() => void copy(entry.id)}
                >
                  {copiedId === entry.id ? <CheckIcon /> : <CopyIcon />}
                </Button>
              </div>
            )
          })}
        </div>
      </div>
      <Separator />
      <p className="px-3 py-2 text-xs text-muted-foreground">
        {t("popup.history.note")}
      </p>
    </div>
  )
}

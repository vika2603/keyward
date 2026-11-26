import { OctagonXIcon, XIcon } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { t } from "@/lib/i18n"

/** How long a notice stays before it goes away by itself. */
const NOTICE_MS = 5000

interface Notice {
  /** Changes with every notice, so the same text shown again starts over. */
  id: number
  text: string
}

/** The notice an overlay shows, with ways to show and dismiss it. */
export function useOverlayNotice() {
  const [notice, setNotice] = useState<Notice | null>(null)
  /** Shows a message; none, as for a cancelled action, shows nothing. */
  const show = useCallback((text: string | null) => {
    if (text) setNotice((current) => ({ id: (current?.id ?? 0) + 1, text }))
  }, [])
  const dismiss = useCallback(() => setNotice(null), [])
  return { notice, show, dismiss }
}

/**
 * Why an action in an in-page overlay failed, drawn like the popup's toasts. The overlay's frame is
 * only as large as its card, so the notice sits at the bottom of the card, where showing it moves
 * nothing above it.
 */
export function OverlayNotice({
  notice,
  onDismiss,
}: {
  notice: Notice | null
  onDismiss: () => void
}) {
  const id = notice?.id
  useEffect(() => {
    if (id === undefined) return
    const timer = setTimeout(onDismiss, NOTICE_MS)
    return () => clearTimeout(timer)
  }, [id, onDismiss])
  if (!notice) return null
  return (
    <div
      key={notice.id}
      role="alert"
      className="flex animate-in items-start gap-2.5 rounded-xl border bg-popover py-2 pr-1.5 pl-2.5 text-xs text-popover-foreground shadow-sm duration-200 fade-in-0 slide-in-from-bottom-1 motion-reduce:animate-none"
    >
      <OctagonXIcon
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-destructive"
      />
      <p className="min-w-0 flex-1 py-0.5 leading-4">{notice.text}</p>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={t("common.close")}
        className="text-muted-foreground"
        onClick={onDismiss}
      >
        <XIcon />
      </Button>
    </div>
  )
}

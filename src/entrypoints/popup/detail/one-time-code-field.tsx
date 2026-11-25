import { RefreshCwIcon } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { callBackground } from "@/background/api"
import { useCopyThrough } from "@/components/keyward/copy-through"
import { t } from "@/lib/i18n"
import type { OneTimeCode } from "@/lib/providers/types"
import { cn } from "@/lib/utils"
import {
  CopyButton,
  copyText,
  DetailRow,
  IconButton,
  RevealButton,
  requestOrNotify,
} from "./detail-parts"

/** The countdown ring's radius in the 24-unit box it is drawn in. */
const RING_RADIUS = 9
/** The countdown turns red for the last seconds of a code. */
const EXPIRY_WARNING_SECONDS = 5

/** Seconds left of a code, drawn as a shrinking ring. */
function Countdown({
  remaining,
  period,
}: {
  remaining: number
  period: number
}) {
  const circumference = 2 * Math.PI * RING_RADIUS
  const label = t("popup.detail.codeExpires", { count: remaining })
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="relative inline-flex size-6 shrink-0 items-center justify-center"
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="absolute inset-0 -rotate-90"
      >
        <circle
          cx="12"
          cy="12"
          r={RING_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.15}
          strokeWidth="2"
        />
        <circle
          cx="12"
          cy="12"
          r={RING_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - remaining / period)}
          className={cn(
            "transition-[stroke-dashoffset] duration-1000 ease-linear",
            remaining <= EXPIRY_WARNING_SECONDS
              ? "text-destructive"
              : "text-primary",
          )}
        />
      </svg>
      <span className="text-[10px] font-medium tabular-nums">{remaining}</span>
    </span>
  )
}

/** A code split in two halves, as authenticator apps show it. */
function CodeText({ code }: { code: string }) {
  const half = Math.ceil(code.length / 2)
  return (
    <span className="font-mono text-lg tracking-wider">
      {code.slice(0, half)}
      <span className="ml-1.5">{code.slice(half)}</span>
    </span>
  )
}

/** What a code looks like before it is shown; as wide as the code itself. */
const CODE_MASK = "••••••"

/**
 * A login's one-time code, masked until it is shown, with the seconds it has left. An expired code
 * is replaced by the next one. Bitwarden codes need no confirmation, so they load at once; Apple's
 * wait for a click and Touch ID.
 */
export function OneTimeCodeField({
  ids,
  apple,
  refreshPaused,
}: {
  ids: { vaultId: string; loginId: string }
  apple: boolean
  /** Holds back the next code while the password waits for Touch ID, so one prompt shows at a time. */
  refreshPaused: boolean
}) {
  const [code, setCode] = useState<OneTimeCode | null>(null)
  const [shown, setShown] = useState(false)
  const [pending, setPending] = useState(false)
  const [now, setNow] = useState(Date.now)
  const valueRef = useRef<HTMLDivElement>(null)

  const loadCode = useCallback(async (): Promise<OneTimeCode | null> => {
    setPending(true)
    const result = await requestOrNotify(() =>
      callBackground("popup.oneTimeCode", ids),
    ).finally(() => setPending(false))
    setCode(result)
    setNow(Date.now())
    return result
  }, [ids])

  const copyCode = useCallback(async () => {
    const current = code ?? (await loadCode())
    return current !== null && copyText(current.code, true)
  }, [code, loadCode])

  const toggle = async () => {
    if (shown) {
      setShown(false)
      return
    }
    const current = code ?? (await loadCode())
    if (current) setShown(true)
  }

  useEffect(() => {
    if (!apple) void loadCode()
  }, [apple, loadCode])

  const expiresAt = code?.expiresAt
  useEffect(() => {
    if (expiresAt === undefined) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [expiresAt])
  useEffect(() => {
    if (
      expiresAt !== undefined &&
      now >= expiresAt &&
      !pending &&
      !refreshPaused
    )
      void loadCode()
  }, [expiresAt, now, pending, refreshPaused, loadCode])

  useCopyThrough(
    valueRef,
    useCallback(() => void copyCode(), [copyCode]),
  )

  const remaining =
    expiresAt === undefined
      ? null
      : Math.max(0, Math.ceil((expiresAt - now) / 1000))

  return (
    <DetailRow
      label={t("popup.detail.code")}
      valueRef={valueRef}
      actions={
        <>
          {code &&
            (remaining !== null && code.period ? (
              <span className="flex size-8 items-center justify-center">
                <Countdown remaining={remaining} period={code.period} />
              </span>
            ) : (
              <IconButton
                label={t("popup.detail.refreshCode")}
                disabled={pending}
                onClick={() => void loadCode()}
              >
                <RefreshCwIcon />
              </IconButton>
            ))}
          <RevealButton
            shown={shown}
            showLabel={t("popup.detail.showCode")}
            hideLabel={t("popup.detail.hideCode")}
            disabled={pending}
            onClick={() => void toggle()}
          />
          <CopyButton
            label={t("popup.copyCode")}
            disabled={pending}
            copy={copyCode}
          />
        </>
      }
    >
      {pending && apple ? (
        <span className="text-xs text-muted-foreground">
          {t("popup.main.confirmTouchId")}
        </span>
      ) : (
        <span className="select-all">
          <CodeText code={code && shown ? code.code : CODE_MASK} />
        </span>
      )}
    </DetailRow>
  )
}

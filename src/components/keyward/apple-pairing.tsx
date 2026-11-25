import { REGEXP_ONLY_DIGITS } from "input-otp"
import { LaptopMinimalCheckIcon, LaptopMinimalIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { callBackground } from "@/background/api"
import { Button } from "@/components/ui/button"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp"
import type { AppleState } from "@/lib/backends/apple/apple-backend"
import { t } from "@/lib/i18n"
import { errorCodeOf, errorMessage } from "./errors"

/**
 * Pairs with Apple Passwords: the helper shows a six-digit code on the Mac, which the user types
 * here. A wrong code ends the attempt, so one new attempt starts and the Mac shows a new code.
 */
export function ApplePairing({
  autoStart,
  onPaired,
}: {
  /** Starts pairing when shown; otherwise a button starts it. */
  autoStart: boolean
  onPaired: () => void
}) {
  const [state, setState] = useState<AppleState | null>(null)
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const started = useRef(false)
  const input = useRef<HTMLInputElement>(null)

  const start = async (restart: boolean) => {
    setBusy(true)
    try {
      const next = await callBackground("apple.startPairing", { restart })
      setState(next)
      if (next.phase === "paired") onPaired()
    } catch (error) {
      setMessage(errorMessage(error))
      setState(await callBackground("apple.state", null).catch(() => null))
    } finally {
      setBusy(false)
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once when shown.
  useEffect(() => {
    if (started.current) return
    started.current = true
    if (autoStart) void start(false)
    else void callBackground("apple.state", null).then(setState, () => {})
  }, [])

  const submit = async (value: string) => {
    setBusy(true)
    setMessage(null)
    try {
      const next = await callBackground("apple.submitCode", { code: value })
      setState(next)
      if (next.phase === "paired") onPaired()
    } catch (error) {
      setCode("")
      if (errorCodeOf(error) === "apple.wrongCode") {
        setMessage(t("pairing.wrongCodeRestarted"))
        setBusy(false)
        await start(true)
        return
      }
      setMessage(errorMessage(error))
      setState(await callBackground("apple.state", null).catch(() => null))
    } finally {
      setBusy(false)
    }
  }

  const phase = state?.phase
  const waiting = phase === "awaitingCode"
  const ready = waiting && !busy
  const hint =
    waiting || autoStart ? t("pairing.enterCode") : t("pairing.startThenEnter")

  // The field is disabled until the Mac shows a code, so focusing it on mount would do nothing.
  useEffect(() => {
    if (ready) input.current?.focus()
  }, [ready])

  const paired = phase === "paired"
  const MacIcon = paired ? LaptopMinimalCheckIcon : LaptopMinimalIcon

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="flex flex-col items-center gap-2">
        <div className="mb-1 flex size-11 items-center justify-center rounded-xl bg-muted text-foreground">
          <MacIcon className="size-6" aria-hidden="true" />
        </div>
        <h2 className="text-base font-medium">{t("pairing.title")}</h2>
        <p className="text-sm text-muted-foreground">
          {phase === "connecting"
            ? t("pairing.connecting")
            : paired
              ? t("pairing.paired")
              : hint}
        </p>
      </div>
      <InputOTP
        ref={input}
        maxLength={6}
        pattern={REGEXP_ONLY_DIGITS}
        value={code}
        onChange={setCode}
        onComplete={(value: string) => void submit(value)}
        disabled={!ready}
        containerClassName="justify-center"
        aria-label={t("pairing.codeLabel")}
      >
        <InputOTPGroup>
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <InputOTPSlot
              key={index}
              index={index}
              className="size-10 text-base font-medium"
            />
          ))}
        </InputOTPGroup>
      </InputOTP>
      {(message || phase === "unavailable") && (
        <p className="text-xs text-destructive">
          {message ?? t("error.apple.unavailable")}
        </p>
      )}
      {!autoStart && !paired && (
        <Button
          className="w-full"
          disabled={busy}
          onClick={() => void start(waiting)}
        >
          {waiting ? t("pairing.newCode") : t("pairing.start")}
        </Button>
      )}
    </div>
  )
}

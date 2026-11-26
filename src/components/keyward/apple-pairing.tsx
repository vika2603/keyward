import { REGEXP_ONLY_DIGITS } from "input-otp"
import {
  LaptopMinimalCheckIcon,
  LaptopMinimalIcon,
  RotateCwIcon,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { APPLE_PAIRING_PORT, callBackground } from "@/background/api"
import { Button } from "@/components/ui/button"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp"
import { t } from "@/lib/i18n"
import {
  type AppleState,
  needsSetup,
} from "@/lib/providers/apple/helper-session"
import { errorCodeOf, errorMessage } from "./errors"
import { FormError } from "./form-field"

/** The digits of the code the Mac shows. */
const CODE_LENGTH = 6
const CODE_SLOTS = Array.from({ length: CODE_LENGTH }, (_, slot) => slot)

function pairingStatus(phase: AppleState["phase"] | undefined): string {
  if (phase === "connecting") return t("pairing.connecting")
  if (phase === "paired") return t("pairing.paired")
  return t("pairing.enterCode")
}

/**
 * Pairs with Apple Passwords: the helper shows a six-digit code on the Mac, which the user types
 * here. A wrong code ends the attempt, so one new attempt starts and the Mac shows a new code.
 */
export function ApplePairing({
  onPaired,
  onSetUp,
}: {
  onPaired: () => void
  /** Opens the setup page, where pairing goes at once while this Mac is not set up yet. */
  onSetUp: () => void
}) {
  const [state, setState] = useState<AppleState | null>(null)
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const started = useRef(false)
  const sentToSetup = useRef(false)
  const codeInputRef = useRef<HTMLInputElement>(null)

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

  // While this view is open the background knows a code is wanted; closing the view ends the
  // pairing, so the Mac's code window does not stay behind.
  useEffect(() => {
    const port = browser.runtime.connect({ name: APPLE_PAIRING_PORT })
    return () => port.disconnect()
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once when shown.
  useEffect(() => {
    if (started.current) return
    started.current = true
    void start(false)
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

  const setupMissing = state !== null && needsSetup(state)
  // Pairing needs the one-time setup first, which runs in a page of its own.
  useEffect(() => {
    if (!setupMissing || sentToSetup.current) return
    sentToSetup.current = true
    onSetUp()
  }, [onSetUp, setupMissing])

  const phase = state?.phase
  const waiting = phase === "awaitingCode"
  const ready = waiting && !busy

  // The field is disabled until the Mac shows a code, so focusing it on mount would do nothing.
  useEffect(() => {
    if (ready) codeInputRef.current?.focus()
  }, [ready])

  // The Mac's code window can take the keyboard from the browser. When the popup gets it back, from
  // a click anywhere but on another control or from switching back, the code goes into the field.
  useEffect(() => {
    if (!ready) return
    const focusCode = () => codeInputRef.current?.focus()
    const onMouseDown = (event: MouseEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest("button, a, input, select, textarea, [tabindex]")
      )
        return
      // Keeps the click from moving the focus to the page itself.
      event.preventDefault()
      focusCode()
    }
    window.addEventListener("focus", focusCode)
    document.addEventListener("mousedown", onMouseDown)
    return () => {
      window.removeEventListener("focus", focusCode)
      document.removeEventListener("mousedown", onMouseDown)
    }
  }, [ready])

  if (setupMissing) return null

  const paired = phase === "paired"
  const MacIcon = paired ? LaptopMinimalCheckIcon : LaptopMinimalIcon

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="flex flex-col items-center gap-2">
        <div className="mb-1 flex size-11 items-center justify-center rounded-xl bg-muted text-foreground">
          <MacIcon className="size-6" aria-hidden="true" />
        </div>
        <h2 className="text-base font-medium">{t("pairing.title")}</h2>
        <p className="text-sm text-muted-foreground">{pairingStatus(phase)}</p>
      </div>
      <InputOTP
        ref={codeInputRef}
        maxLength={CODE_LENGTH}
        pattern={REGEXP_ONLY_DIGITS}
        value={code}
        onChange={setCode}
        onComplete={(value: string) => void submit(value)}
        disabled={!ready}
        containerClassName="justify-center"
        aria-label={t("pairing.codeLabel")}
      >
        <InputOTPGroup>
          {CODE_SLOTS.map((slot) => (
            <InputOTPSlot
              key={slot}
              index={slot}
              className="size-10 text-base font-medium"
            />
          ))}
        </InputOTPGroup>
      </InputOTP>
      <FormError>
        {message ??
          (phase === "unavailable" ? t("error.apple.unavailable") : null)}
      </FormError>
      {/* For a code that was dismissed or expired on the Mac; each click asks for one new code. */}
      {(phase === "awaitingCode" || phase === "unpaired") && (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          disabled={busy}
          onClick={() => {
            setCode("")
            setMessage(null)
            void start(true)
          }}
        >
          <RotateCwIcon />
          {t("pairing.newCode")}
        </Button>
      )}
    </div>
  )
}

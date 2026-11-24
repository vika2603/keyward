import { REGEXP_ONLY_DIGITS } from "input-otp"
import { useEffect, useRef, useState } from "react"
import { callBackground } from "@/background/api"
import { Button } from "@/components/ui/button"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp"
import type { AppleState } from "@/lib/backends/apple/apple-backend"
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
        setMessage("验证码不正确。Mac 上已显示新的验证码，请重新输入。")
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
  const hint =
    waiting || autoStart
      ? "输入 Mac 上显示的六位验证码。"
      : "点击开始配对后，输入 Mac 上显示的六位验证码。"

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-sm leading-none font-medium">验证码</span>
        <InputOTP
          maxLength={6}
          pattern={REGEXP_ONLY_DIGITS}
          value={code}
          onChange={setCode}
          onComplete={(value: string) => void submit(value)}
          disabled={!waiting || busy}
          autoFocus
          aria-label="六位验证码"
        >
          <InputOTPGroup>
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <InputOTPSlot
                key={index}
                index={index}
                className="size-9 font-medium"
              />
            ))}
          </InputOTPGroup>
        </InputOTP>
        <span className="text-xs text-muted-foreground">
          {phase === "connecting"
            ? "正在连接 Apple 密码…"
            : phase === "paired"
              ? "已配对。"
              : hint}
        </span>
        {message && <span className="text-xs text-destructive">{message}</span>}
        {phase === "unavailable" && !message && (
          <span className="text-xs text-destructive">
            无法连接 Apple 密码。需要 macOS 上的 Chrome 和系统自带的密码组件。
          </span>
        )}
      </div>
      {!autoStart && phase !== "paired" && (
        <Button
          className="w-full"
          disabled={busy}
          onClick={() => void start(waiting)}
        >
          {waiting ? "重新获取验证码" : "开始配对"}
        </Button>
      )}
    </div>
  )
}

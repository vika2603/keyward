import { ShieldAlertIcon } from "lucide-react"
import { useCallback, useRef, useState } from "react"
import { callBackground } from "@/background/api"
import { useCopyThrough } from "@/components/keyward/copy-through"
import { notify } from "@/components/keyward/notify"
import { t } from "@/lib/i18n"
import {
  CopyButton,
  copyText,
  DetailRow,
  IconButton,
  MaskText,
  RevealButton,
  requestOrNotify,
  SecretText,
} from "./detail-parts"

/**
 * A login's password, masked until it is shown. It is read from the vault only when shown or
 * copied, and once; Apple asks for Touch ID first, which the field says meanwhile.
 */
export function PasswordField({
  ids,
  apple,
  onPendingChange,
}: {
  ids: { vaultId: string; loginId: string }
  apple: boolean
  /** Tells whether the password waits for Touch ID or the provider. */
  onPendingChange: (pending: boolean) => void
}) {
  const [password, setPassword] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [pending, setPending] = useState(false)
  const [checkingBreach, setCheckingBreach] = useState(false)
  const valueRef = useRef<HTMLDivElement>(null)

  const checkBreach = async () => {
    setCheckingBreach(true)
    const result = await requestOrNotify(() =>
      callBackground("popup.checkBreach", ids),
    ).finally(() => setCheckingBreach(false))
    if (result) {
      notify(
        result.count > 0
          ? t("popup.security.breachFound", { count: result.count })
          : t("popup.security.breachClear"),
      )
    }
  }

  const readPassword = useCallback(async (): Promise<string | null> => {
    if (password !== null) return password
    setPending(true)
    onPendingChange(true)
    const result = await requestOrNotify(() =>
      callBackground("popup.revealPassword", ids),
    ).finally(() => {
      setPending(false)
      onPendingChange(false)
    })
    if (result) setPassword(result.password)
    return result?.password ?? null
  }, [password, ids, onPendingChange])

  const copyPassword = useCallback(async () => {
    const value = await readPassword()
    return value !== null && copyText(value, true)
  }, [readPassword])

  const toggle = async () => {
    if (revealed) {
      setRevealed(false)
      return
    }
    const value = await readPassword()
    if (value !== null) setRevealed(true)
  }

  useCopyThrough(
    valueRef,
    useCallback(() => void copyPassword(), [copyPassword]),
  )

  return (
    <DetailRow
      label={t("popup.detail.password")}
      valueRef={valueRef}
      actions={
        <>
          <IconButton
            label={t("popup.security.checkBreach")}
            disabled={pending || checkingBreach}
            onClick={() => void checkBreach()}
          >
            <ShieldAlertIcon />
          </IconButton>
          <RevealButton
            shown={revealed}
            showLabel={t("popup.detail.showPassword")}
            hideLabel={t("popup.detail.hidePassword")}
            disabled={pending}
            onClick={() => void toggle()}
          />
          <CopyButton
            label={t("popup.copyPassword")}
            disabled={pending}
            copy={copyPassword}
          />
        </>
      }
    >
      <PasswordValue
        password={revealed ? password : null}
        awaitingTouchId={pending && apple}
      />
    </DetailRow>
  )
}

/** The password while it is shown, a mask otherwise, or the Touch ID request it waits for. */
function PasswordValue({
  password,
  awaitingTouchId,
}: {
  password: string | null
  awaitingTouchId: boolean
}) {
  if (awaitingTouchId)
    return (
      <span className="text-xs text-muted-foreground">
        {t("popup.main.confirmTouchId")}
      </span>
    )
  return password === null ? <MaskText /> : <SecretText value={password} />
}

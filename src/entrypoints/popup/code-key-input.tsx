import { SecretInput } from "@/components/keyward/secret-input"
import { t } from "@/lib/i18n"

/** An authenticator key, a secret like a password: hidden until its eye button shows it. */
export function CodeKeyInput({
  id,
  value,
  onChange,
}: {
  id?: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <SecretInput
      id={id}
      showLabel={t("popup.edit.showCodeKey")}
      hideLabel={t("popup.edit.hideCodeKey")}
      value={value}
      placeholder={t("popup.edit.codeKeyHint")}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

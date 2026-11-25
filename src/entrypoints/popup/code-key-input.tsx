import { EyeIcon, EyeOffIcon } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
  const [shown, setShown] = useState(false)
  const label = shown
    ? t("popup.edit.hideCodeKey")
    : t("popup.edit.showCodeKey")
  return (
    <div className="relative">
      <Input
        id={id}
        type={shown ? "text" : "password"}
        className="pr-9 font-mono placeholder:font-sans"
        value={value}
        placeholder={t("popup.edit.codeKeyHint")}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
        spellCheck={false}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute top-0.5 right-0.5"
        aria-label={label}
        title={label}
        onClick={() => setShown((current) => !current)}
      >
        {shown ? <EyeOffIcon /> : <EyeIcon />}
      </Button>
    </div>
  )
}

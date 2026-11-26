import { EyeIcon, EyeOffIcon } from "lucide-react"
import { type ComponentProps, type ReactNode, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { t } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/**
 * An input for a secret, hidden until its eye button shows it, with room for one more button after
 * the eye. The shown state is the input's own unless `shown` is given.
 */
export function SecretInput({
  showLabel,
  hideLabel,
  shown: controlledShown,
  onShownChange,
  action,
  className,
  ...props
}: Omit<ComponentProps<typeof Input>, "type"> & {
  showLabel?: string
  hideLabel?: string
  shown?: boolean
  onShownChange?: (shown: boolean) => void
  /** A button after the eye, such as one that generates a new secret. */
  action?: ReactNode
}) {
  const [ownShown, setOwnShown] = useState(false)
  const shown = controlledShown ?? ownShown
  const toggle = () => {
    setOwnShown(!shown)
    onShownChange?.(!shown)
  }
  const eyeLabel = shown
    ? (hideLabel ?? t("popup.detail.hidePassword"))
    : (showLabel ?? t("popup.detail.showPassword"))
  return (
    <div className="relative min-w-0">
      <Input
        type={shown ? "text" : "password"}
        className={cn(
          "font-mono placeholder:font-sans",
          action ? "pr-16" : "pr-9",
          className,
        )}
        autoComplete="off"
        spellCheck={false}
        {...props}
      />
      <div className="absolute inset-y-0 right-0.5 flex items-center">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
          aria-label={eyeLabel}
          title={eyeLabel}
          onClick={toggle}
        >
          {shown ? <EyeOffIcon /> : <EyeIcon />}
        </Button>
        {action}
      </div>
    </div>
  )
}

import { CheckIcon, CopyIcon, EyeIcon, EyeOffIcon } from "lucide-react"
import { type ReactNode, type RefObject, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { currentLanguage, t } from "@/lib/i18n"

/** Shown in place of a secret that is not revealed; it does not tell the secret's length. */
const MASK = "••••••••••••"

export function MaskText() {
  return <span className="font-mono tracking-wider">{MASK}</span>
}

function charClass(char: string): string | undefined {
  if (/[0-9]/.test(char)) return "text-blue-600 dark:text-blue-400"
  if (/[a-zA-Z]/.test(char)) return undefined
  return "text-amber-700 dark:text-amber-400"
}

/** A revealed secret, with digits and symbols coloured apart from letters. */
export function SecretText({ value }: { value: string }) {
  return (
    <span className="font-mono select-all">
      {[...value].map((char, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: characters repeat; their position is their identity.
        <span key={index} className={charClass(char)}>
          {char}
        </span>
      ))}
    </span>
  )
}

export function formatDate(time: number): string {
  return new Intl.DateTimeFormat(currentLanguage(), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(time)
}

export function Section({
  title,
  children,
}: {
  title?: string
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-1.5">
      {title && (
        <h2 className="px-1 text-xs font-medium text-muted-foreground">
          {title}
        </h2>
      )}
      <div className="rounded-xl bg-card ring-1 ring-foreground/10">
        {children}
      </div>
    </section>
  )
}

export function Field({
  label,
  children,
  actions,
  valueRef,
}: {
  label?: string
  children: ReactNode
  actions?: ReactNode
  valueRef?: RefObject<HTMLDivElement | null>
}) {
  return (
    <div className="flex min-h-12 items-center gap-1 border-t py-2 pr-2 pl-3 first:border-t-0">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {label && (
          <span className="text-xs text-muted-foreground">{label}</span>
        )}
        <div ref={valueRef} className="text-sm break-all">
          {children}
        </div>
      </div>
      {actions && <div className="flex shrink-0 gap-0.5">{actions}</div>}
    </div>
  )
}

export function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

/** The eye button that shows or hides a secret. */
export function RevealButton({
  shown,
  showLabel,
  hideLabel,
  disabled,
  onClick,
}: {
  shown: boolean
  showLabel: string
  hideLabel: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <IconButton
      label={shown ? hideLabel : showLabel}
      disabled={disabled}
      onClick={onClick}
    >
      {shown ? <EyeOffIcon /> : <EyeIcon />}
    </IconButton>
  )
}

/** A copy button that shows a check for a moment once the copy went through. */
export function CopyButton({
  label,
  copy,
  disabled,
}: {
  label: string
  copy: () => Promise<boolean>
  disabled?: boolean
}) {
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!done) return
    const timer = setTimeout(() => setDone(false), 1500)
    return () => clearTimeout(timer)
  }, [done])
  return (
    <IconButton
      label={done ? t("popup.copied") : label}
      disabled={disabled}
      onClick={() => void copy().then(setDone)}
    >
      {done ? <CheckIcon /> : <CopyIcon />}
    </IconButton>
  )
}

/** Toggles one index in a set of shown entries, such as revealed fields of a list. */
export function toggled(
  shown: ReadonlySet<number>,
  index: number,
): ReadonlySet<number> {
  const next = new Set(shown)
  if (next.has(index)) next.delete(index)
  else next.add(index)
  return next
}

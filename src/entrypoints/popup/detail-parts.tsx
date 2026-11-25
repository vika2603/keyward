import {
  CheckIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  Trash2Icon,
} from "lucide-react"
import { type ReactNode, type RefObject, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { currentLanguage, t } from "@/lib/i18n"
import type { CustomField } from "@/lib/providers/types"

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

export function CustomFieldRow({
  field,
  shown,
  onToggle,
  copyText,
}: {
  field: CustomField
  shown: boolean
  onToggle: () => void
  copyText: (text: string, secret: boolean) => Promise<boolean>
}) {
  switch (field.kind) {
    case "text":
      return (
        <Field
          label={field.name}
          actions={
            field.value && (
              <CopyButton
                label={t("popup.detail.copyField")}
                copy={() => copyText(field.value, false)}
              />
            )
          }
        >
          <span className="whitespace-pre-wrap">{field.value}</span>
        </Field>
      )
    case "hidden":
      return (
        <Field
          label={field.name}
          actions={
            field.value && (
              <>
                <RevealButton
                  shown={shown}
                  showLabel={t("popup.detail.showField")}
                  hideLabel={t("popup.detail.hideField")}
                  onClick={onToggle}
                />
                <CopyButton
                  label={t("popup.detail.copyField")}
                  copy={() => copyText(field.value, true)}
                />
              </>
            )
          }
        >
          {shown ? <SecretText value={field.value} /> : <MaskText />}
        </Field>
      )
    case "checkbox":
      return (
        <Field label={field.name}>
          {field.checked
            ? t("popup.detail.checked")
            : t("popup.detail.unchecked")}
        </Field>
      )
    case "linked": {
      const target =
        field.linkedTo === "username"
          ? t("popup.detail.username")
          : t("popup.detail.password")
      return (
        <Field label={field.name}>
          <span className="text-muted-foreground">
            {t("popup.detail.linkedTo", { field: target })}
          </span>
        </Field>
      )
    }
  }
}

/** A line of the item info card: a name on the left, its value on the right. */
export function InfoRow({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-10 items-center gap-3 border-t px-3 py-2 text-sm first:border-t-0">
      <span className="shrink-0">{label}</span>
      <span className="flex min-w-0 flex-1 items-center justify-end gap-1.5 text-muted-foreground">
        {children}
      </span>
    </div>
  )
}

/**
 * The delete button of a detail view. Deleting asks twice: the first click arms the button and
 * shows where the item goes; leaving the button disarms it.
 */
export function DeleteButton({
  hint,
  onDelete,
}: {
  hint: string
  /** False when the delete failed; the button can then be used again. */
  onDelete: () => Promise<boolean>
}) {
  const [state, setState] = useState<"armed" | "busy" | null>(null)
  const click = async () => {
    if (state !== "armed") {
      setState("armed")
      return
    }
    setState("busy")
    if (!(await onDelete())) setState(null)
  }
  return (
    <div className="flex flex-col gap-1.5">
      <Button
        variant={state ? "destructive" : "outline"}
        disabled={state === "busy"}
        onClick={() => void click()}
        onBlur={() =>
          setState((current) => (current === "armed" ? null : current))
        }
      >
        <Trash2Icon />
        {state ? t("popup.detail.confirmDelete") : t("popup.detail.delete")}
      </Button>
      {state && <p className="px-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

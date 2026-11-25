import {
  CheckIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  StarIcon,
  Trash2Icon,
} from "lucide-react"
import { type ReactNode, type RefObject, useState } from "react"
import { callBackground } from "@/background/api"
import { FormError } from "@/components/keyward/form-field"
import { notifyError } from "@/components/keyward/notify"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAsyncAction } from "@/hooks/use-async-action"
import {
  COPIED_FEEDBACK_MS,
  useTransientValue,
} from "@/hooks/use-transient-value"
import { t } from "@/lib/i18n"
import type { CustomField } from "@/lib/providers/types"
import { cn } from "@/lib/utils"

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

/** Runs a request and shows its error as a toast; null when it failed. */
export async function requestOrNotify<T>(
  request: () => Promise<T>,
): Promise<T | null> {
  try {
    return await request()
  } catch (error) {
    notifyError(error)
    return null
  }
}

/**
 * Copies text through the background, which clears a secret from the clipboard after a while; false
 * when the copy failed and a toast says why.
 */
export async function copyText(
  text: string,
  secret: boolean,
): Promise<boolean> {
  try {
    await callBackground("popup.copyText", { text, secret })
    return true
  } catch (error) {
    notifyError(error)
    return false
  }
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

/** A row of a detail card: an optional label over the value, and the value's buttons on the right. */
export function DetailRow({
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

/**
 * The star in a detail view's header. It turns at once, and turns back when the vault refuses the
 * change, whose toast says why.
 */
export function FavoriteButton({
  vaultId,
  itemId,
  favorite,
  onChange,
}: {
  vaultId: string
  itemId: string
  favorite: boolean
  onChange: (favorite: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  const label = favorite
    ? t("popup.detail.unfavorite")
    : t("popup.detail.favorite")
  const toggle = async () => {
    setBusy(true)
    onChange(!favorite)
    try {
      await callBackground("popup.setFavorite", {
        vaultId,
        itemId,
        favorite: !favorite,
      })
    } catch (error) {
      onChange(favorite)
      notifyError(error)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      aria-pressed={favorite}
      disabled={busy}
      onClick={() => void toggle()}
    >
      <StarIcon className={cn(favorite && "fill-current")} />
    </Button>
  )
}

/**
 * Asks for the master password of an item that wants it again, and opens the item for a few
 * minutes once it is right.
 */
export function RepromptForm({
  vaultId,
  itemId,
  hint,
  onPassed,
}: {
  vaultId: string
  itemId: string
  hint: string
  onPassed: () => void
}) {
  const [password, setPassword] = useState("")
  const { busy, message, run } = useAsyncAction()
  const submit = async () => {
    const passed = await run(() =>
      callBackground("popup.passReprompt", { vaultId, itemId, password }),
    )
    if (!passed) return
    setPassword("")
    onPassed()
  }
  return (
    <form
      className="flex flex-col gap-2 px-3 py-3"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <p className="text-xs text-muted-foreground">{hint}</p>
      <div className="flex gap-2">
        <Input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={t("popup.reprompt.password")}
          aria-label={t("popup.reprompt.password")}
          autoComplete="current-password"
          autoFocus
        />
        <Button type="submit" disabled={busy || !password}>
          {t("popup.reprompt.submit")}
        </Button>
      </div>
      <FormError>{message}</FormError>
    </form>
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
  const [done, showDone] = useTransientValue<true>(COPIED_FEEDBACK_MS)
  return (
    <IconButton
      label={done ? t("popup.copied") : label}
      disabled={disabled}
      onClick={() =>
        void copy().then((copied) => {
          if (copied) showDone(true)
        })
      }
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
}: {
  field: CustomField
  shown: boolean
  onToggle: () => void
}) {
  switch (field.kind) {
    case "text":
      return (
        <DetailRow
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
        </DetailRow>
      )
    case "hidden":
      return (
        <DetailRow
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
        </DetailRow>
      )
    case "checkbox":
      return (
        <DetailRow label={field.name}>
          {field.checked
            ? t("popup.detail.checked")
            : t("popup.detail.unchecked")}
        </DetailRow>
      )
    case "linked": {
      const target =
        field.linkedTo === "username"
          ? t("popup.detail.username")
          : t("popup.detail.password")
      return (
        <DetailRow label={field.name}>
          <span className="text-muted-foreground">
            {t("popup.detail.linkedTo", { field: target })}
          </span>
        </DetailRow>
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

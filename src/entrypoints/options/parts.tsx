import { type ReactNode, useState } from "react"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"

export function PageHeader({
  title,
  description,
}: {
  title: string
  description?: string
}) {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="text-xl leading-7 font-semibold tracking-tight">
        {title}
      </h1>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
    </header>
  )
}

export function Section({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex min-h-7 flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-medium">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export function Card({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn("rounded-xl bg-card ring-1 ring-foreground/10", className)}
    >
      {children}
    </div>
  )
}

/** One setting: its name and description on the left, its control on the right. */
export function Option({
  name,
  description,
  children,
  className,
}: {
  name: ReactNode
  description?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t px-4 py-3 first:border-t-0",
        className,
      )}
    >
      <div className="flex min-w-0 shrink grow basis-[260px] flex-col gap-0.5">
        <span className="text-sm font-medium">{name}</span>
        {description && (
          <span className="text-sm text-muted-foreground">{description}</span>
        )}
      </div>
      {children}
    </div>
  )
}

/**
 * A choice among a few values, drawn as a row of toggle buttons on a track, like a tab list. The
 * pressed button stays pressed when clicked again, as one value is always chosen.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: readonly (readonly [T, string])[]
  onChange: (value: T) => void
  label: string
}) {
  return (
    <ToggleGroup
      aria-label={label}
      value={[value]}
      onValueChange={([chosen]) => {
        const option = options.find(([optionValue]) => optionValue === chosen)
        if (option) onChange(option[0])
      }}
      className="inline-flex h-8 max-w-full min-w-0 gap-0 bg-muted p-[3px]"
    >
      {options.map(([optionValue, text]) => (
        <ToggleGroupItem
          key={optionValue}
          value={optionValue}
          className="h-full shrink rounded-md border border-transparent text-foreground/60 hover:bg-transparent aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm dark:text-muted-foreground dark:aria-pressed:border-input dark:aria-pressed:bg-input/30 dark:aria-pressed:text-foreground"
        >
          {text}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

/** The label of a value in a list of values and their labels. */
export function nameOf<T>(
  names: readonly (readonly [T, string])[],
  value: T,
): string {
  return names.find(([candidate]) => candidate === value)?.[1] ?? ""
}

/** A choice among values of any kind, drawn as a select; the values become strings only on the way through. */
export function ChoiceSelect<T extends string | number>({
  names,
  value,
  onChange,
  label,
  id,
  className,
}: {
  names: readonly (readonly [T, string])[]
  value: T
  onChange: (value: T) => void
  label: string
  /** The trigger's id, for a visible label. */
  id?: string
  className?: string
}) {
  return (
    <Select
      value={String(value)}
      onValueChange={(next) => {
        const found = names.find(([candidate]) => String(candidate) === next)
        if (found) onChange(found[0])
      }}
      items={names.map(([candidate, text]) => ({
        value: String(candidate),
        label: text,
      }))}
    >
      <SelectTrigger id={id} aria-label={label} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {names.map(([candidate, text]) => (
            <SelectItem key={String(candidate)} value={String(candidate)}>
              {text}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

/**
 * Starts a dialog's fields afresh at each opening. `opening` is what the dialog shows, null while
 * it is closed; `reset` sets the fields from a new one, during render, so the first frame of the
 * dialog already shows them. Returns the last opening, which stays while the dialog fades out
 * after closing.
 */
export function useDialogOpening<T>(
  opening: T | null,
  reset?: (opening: T) => void,
): T | null {
  const [current, setCurrent] = useState<T | null>(null)
  const [last, setLast] = useState<T | null>(null)
  if (opening !== current) {
    setCurrent(opening)
    if (opening !== null) {
      setLast(opening)
      reset?.(opening)
    }
  }
  return opening ?? last
}

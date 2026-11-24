import type { ReactNode } from "react"
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

/** A choice among a few values, drawn as a row of toggle buttons. */
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
    <fieldset
      aria-label={label}
      className="inline-flex h-8 max-w-full min-w-0 items-center rounded-lg bg-muted p-[3px]"
    >
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          aria-pressed={v === value}
          onClick={() => onChange(v)}
          className="inline-flex h-full items-center justify-center rounded-md border border-transparent px-2.5 text-sm font-medium whitespace-nowrap text-foreground/60 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm dark:text-muted-foreground dark:aria-pressed:border-input dark:aria-pressed:bg-input/30 dark:aria-pressed:text-foreground"
        >
          {text}
        </button>
      ))}
    </fieldset>
  )
}

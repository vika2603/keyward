import { type ComponentProps, type ReactNode, useId, useState } from "react"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

const LABEL_CLASS = "text-xs font-medium text-muted-foreground"

/**
 * A row of the generator's options: a name in a column of its own, the controls beside it, and an
 * optional hint under the controls. A name for one control is its label; a name for several names
 * the group they form.
 */
export function OptionRow({
  label,
  htmlFor,
  labelId,
  groupLabel,
  hint,
  children,
}: {
  label: string
  /** The one control the name labels. */
  htmlFor?: string
  /** The name's ID, for controls that point at it themselves. */
  labelId?: string
  /** The group's accessible name, when it says more than the name shown. */
  groupLabel?: string
  hint?: string
  children: ReactNode
}) {
  const generatedId = useId()
  const id = labelId ?? generatedId
  // A row with a hint keeps its controls' line as tall as the controls' part of a row without one.
  const controls = (
    <div
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-2",
        hint && "min-h-8",
      )}
    >
      {children}
    </div>
  )
  return (
    <div className="grid min-h-12 grid-cols-[--spacing(17)_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 border-t px-3 py-2.5 first:border-t-0">
      {htmlFor ? (
        <label htmlFor={htmlFor} className={LABEL_CLASS}>
          {label}
        </label>
      ) : (
        <span id={id} className={LABEL_CLASS}>
          {label}
        </span>
      )}
      {htmlFor ? (
        controls
      ) : (
        // Chrome does not lay out a fieldset's content as a flex container of its height, so the
        // fieldset only names the group and the div inside lays it out.
        <fieldset
          className="min-w-0"
          aria-labelledby={groupLabel ? undefined : id}
          aria-label={groupLabel}
        >
          {controls}
        </fieldset>
      )}
      {hint && (
        <p className="col-start-2 text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  )
}

export function CheckboxOption({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}) {
  return (
    <label className="flex items-center gap-1.5 text-sm whitespace-nowrap">
      <Checkbox checked={checked} onCheckedChange={() => onChange(!checked)} />
      {label}
    </label>
  )
}

/** A number input that keeps what is typed and reports it once it is a whole number from `min` to `max`. */
export function NumberInput({
  value,
  min,
  max,
  onValueChange,
  className,
  ...props
}: Omit<
  ComponentProps<typeof Input>,
  "type" | "value" | "min" | "max" | "onChange" | "onBlur"
> & {
  value: number
  min: number
  max: number
  onValueChange: (value: number) => void
}) {
  // Typing a number passes through values out of range, such as "1" on the way to "128".
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <Input
      {...props}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={draft ?? String(value)}
      className={cn(
        "[appearance:textfield] text-center tabular-nums [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
        className,
      )}
      onChange={(event) => {
        const text = event.target.value
        const number = Number(text)
        setDraft(text)
        if (
          text !== "" &&
          Number.isInteger(number) &&
          number >= min &&
          number <= max
        )
          onValueChange(number)
      }}
      onBlur={() => setDraft(null)}
    />
  )
}

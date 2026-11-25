import { type ReactNode, useId } from "react"
import {
  Field,
  FieldError,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field"
import { cn } from "@/lib/utils"

/**
 * A field of the popup's forms: its name over its control. A name with `htmlFor` labels that
 * control; without it, the name titles the group of controls below.
 */
export function FormField({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor?: string
  children: ReactNode
}) {
  const titleId = useId()
  // The popup's labels sit on one tight line, closer to their controls than Field's own.
  return (
    <Field aria-labelledby={htmlFor ? undefined : titleId}>
      {htmlFor ? (
        <FieldLabel htmlFor={htmlFor} className="leading-none">
          {label}
        </FieldLabel>
      ) : (
        <FieldTitle id={titleId} className="leading-none">
          {label}
        </FieldTitle>
      )}
      {children}
    </Field>
  )
}

/** Why a form's action failed, in the popup's small type; nothing while there is no message. */
export function FormError({
  className,
  children,
}: {
  className?: string
  children: string | null
}) {
  return (
    <FieldError className={cn("text-xs", className)}>{children}</FieldError>
  )
}

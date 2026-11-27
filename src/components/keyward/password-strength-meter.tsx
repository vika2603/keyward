import { useMemo } from "react"
import { type MessageKey, t } from "@/lib/i18n"
import {
  evaluatePasswordStrength,
  type StrengthLevel,
} from "@/lib/security-check"
import { cn } from "@/lib/utils"

const LEVEL_LABELS: Record<StrengthLevel, MessageKey> = {
  weak: "popup.security.strength.weak",
  fair: "popup.security.strength.fair",
  good: "popup.security.strength.good",
  strong: "popup.security.strength.strong",
}

const LEVEL_COLORS: Record<StrengthLevel, string> = {
  weak: "bg-destructive",
  fair: "bg-amber-500",
  good: "bg-emerald-500",
  strong: "bg-emerald-600",
}

/** Local zxcvbn strength bar for password inputs and generated passwords. */
export function PasswordStrengthMeter({
  password,
  userInputs = [],
}: {
  password: string
  userInputs?: readonly string[]
}) {
  const result = useMemo(
    () => (password ? evaluatePasswordStrength(password, userInputs) : null),
    [password, userInputs],
  )
  if (!result) return null
  const filledBars = Math.max(1, result.score)
  const label = t(LEVEL_LABELS[result.level])
  return (
    <div
      data-testid="password-strength-meter"
      data-level={result.level}
      className="flex items-center gap-2 pt-0.5"
    >
      <div className="flex flex-1 gap-1" aria-hidden="true">
        {[1, 2, 3, 4].map((bar) => (
          <span
            key={bar}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors",
              bar <= filledBars ? LEVEL_COLORS[result.level] : "bg-muted",
            )}
          />
        ))}
      </div>
      <span className="text-[11px] font-medium text-muted-foreground">
        {label}
      </span>
    </div>
  )
}

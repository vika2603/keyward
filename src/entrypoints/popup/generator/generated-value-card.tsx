import { CheckIcon, CopyIcon, RefreshCwIcon } from "lucide-react"
import { Fragment, useCallback, useRef } from "react"
import { callBackground } from "@/background/api"
import { useCopyThrough } from "@/components/keyward/copy-through"
import { errorMessage } from "@/components/keyward/errors"
import { Button } from "@/components/ui/button"
import {
  COPIED_FEEDBACK_MS,
  useTransientValue,
} from "@/hooks/use-transient-value"
import type { GeneratorKind } from "@/lib/generator"
import { t } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { SecretText } from "../detail/detail-parts"
import { recordShown } from "./use-generator-state"

/** A generated passphrase or username, which may wrap after its "+" and "@" rather than mid-word. */
function WrappingText({ value }: { value: string }) {
  return value.split(/(?<=[+@])/).map((part, index) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: parts repeat; their position is their identity.
    <Fragment key={index}>
      {index > 0 && <wbr />}
      {part}
    </Fragment>
  ))
}

/** The value generated for the kind, with the buttons that regenerate and copy it. */
export function GeneratedValueCard({
  kind,
  value,
  missingInputHint,
  onRegenerate,
  onMessage,
}: {
  kind: GeneratorKind
  /** Null while it cannot be generated yet. */
  value: string | null
  /** What the kind needs before it can be generated, if anything. */
  missingInputHint: string | null
  onRegenerate: () => void
  /** Shows a copy's error, or clears it with null. */
  onMessage: (message: string | null) => void
}) {
  const [copiedValue, showCopied] =
    useTransientValue<string>(COPIED_FEEDBACK_MS)
  const copied = value !== null && copiedValue === value
  const valueRef = useRef<HTMLDivElement>(null)

  const copy = useCallback(async () => {
    if (value === null) return
    onMessage(null)
    try {
      // Kept with its kind right away, since another value may replace it before it settles.
      await recordShown(value, kind, true)
      if (kind === "username")
        await callBackground("popup.copyText", { text: value })
      else await callBackground("generator.copy", { password: value })
      showCopied(value)
    } catch (error) {
      onMessage(errorMessage(error))
    }
  }, [value, kind, onMessage, showCopied])
  useCopyThrough(
    valueRef,
    useCallback(() => void copy(), [copy]),
  )

  const copyLabel = copied ? t("popup.copied") : t("popup.generator.copy")
  return (
    <div className="flex min-h-14 items-center gap-1 rounded-xl bg-card py-2 pr-2 pl-3 ring-1 ring-foreground/10">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {value !== null ? (
          <div
            ref={valueRef}
            className={cn(
              "font-mono text-base leading-normal select-all",
              kind === "password" ? "break-all" : "[overflow-wrap:anywhere]",
            )}
          >
            {kind === "password" ? (
              <SecretText value={value} />
            ) : (
              <WrappingText value={value} />
            )}
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">
            {missingInputHint ?? "…"}
          </span>
        )}
        {kind === "passphrase" && value !== null && (
          <span className="text-xs text-muted-foreground">
            {t("popup.generator.passphraseLength", { count: value.length })}
          </span>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("popup.generator.regenerate")}
        title={t("popup.generator.regenerate")}
        disabled={value === null}
        onClick={onRegenerate}
      >
        <RefreshCwIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={copyLabel}
        title={copyLabel}
        disabled={value === null}
        onClick={() => void copy()}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </div>
  )
}

import { HistoryIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { GeneratorKind } from "@/lib/generator"
import { type MessageKey, t } from "@/lib/i18n"
import { BackHeader } from "../header"
import { GeneratedValueCard } from "./generated-value-card"
import { PassphraseOptionsForm } from "./passphrase-options"
import { PasswordOptionsForm } from "./password-options"
import { useGeneratorState } from "./use-generator-state"
import { UsernameOptionsForm } from "./username-options"

const KINDS: [GeneratorKind, MessageKey][] = [
  ["password", "popup.generator.kind.password"],
  ["passphrase", "popup.generator.kind.passphrase"],
  ["username", "popup.generator.kind.username"],
]

/** Generates passwords, passphrases and usernames; the shown values last for the browser session. */
export function GeneratorView({
  onBack,
  onHistory,
}: {
  onBack: () => void
  onHistory: () => void
}) {
  const generator = useGeneratorState()
  // The saved options load from storage at once; the view waits for them rather than show defaults.
  if (!generator) return null

  const { kind, choices } = generator
  const usernameType = choices.username.type
  let missingInputHint: string | null = null
  if (kind === "username" && usernameType === "plusEmail")
    missingInputHint = t("popup.generator.needEmail")
  else if (kind === "username" && usernameType === "catchAll")
    missingInputHint = t("popup.generator.needDomain")

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BackHeader title={t("popup.generator.title")} onBack={onBack}>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("popup.history.title")}
          title={t("popup.history.title")}
          onClick={onHistory}
        >
          <HistoryIcon />
        </Button>
      </BackHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-2 px-3 pb-3">
          <Tabs
            value={kind}
            onValueChange={(next) =>
              generator.chooseKind(next as GeneratorKind)
            }
          >
            <TabsList
              className="w-full"
              aria-label={t("popup.generator.kindsLabel")}
            >
              {KINDS.map(([value, label]) => (
                <TabsTrigger key={value} value={value}>
                  {t(label)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <GeneratedValueCard
            kind={kind}
            value={generator.value}
            missingInputHint={missingInputHint}
            onRegenerate={generator.regenerate}
            onMessage={generator.setMessage}
          />
          {generator.message && (
            <p className="text-xs text-destructive">{generator.message}</p>
          )}
        </div>
        <Separator />
        {kind === "password" && (
          <PasswordOptionsForm
            options={generator.passwordOptions}
            onChange={generator.updatePasswordOptions}
          />
        )}
        {kind === "passphrase" && (
          <PassphraseOptionsForm
            options={choices.passphrase}
            onChange={generator.updatePassphrase}
          />
        )}
        {kind === "username" && (
          <UsernameOptionsForm
            options={choices.username}
            onChange={generator.updateUsername}
          />
        )}
      </div>
    </div>
  )
}

import {
  FingerprintPatternIcon,
  KeyRoundIcon,
  LoaderCircleIcon,
  PlusIcon,
} from "lucide-react"
import { useEffect, useState } from "react"
import { callBackground, PASSKEY_PORT } from "@/background/api"
import { BrandIcon } from "@/components/keyward/brand-icon"
import { notifyError } from "@/components/keyward/notify"
import { SiteIcon } from "@/components/keyward/site-icon"
import { Button } from "@/components/ui/button"
import { t } from "@/lib/i18n"
import type { PasskeyOption, PasskeyPromptView } from "@/lib/passkeys/types"
import type { VaultInfo } from "@/lib/providers/types"
import { LockedVaultCard } from "./connect-card"
import { closeIfPopup } from "./pop-out"

/**
 * Held open while the popup displays or unlocks for a modal WebAuthn passkey prompt.
 * Closing the popup without a choice cancels the page's request cleanly.
 */
let held: Browser.runtime.Port | null = null

function holdPasskeyPrompt(): void {
  if (!held) held = browser.runtime.connect({ name: PASSKEY_PORT })
}

/**
 * Modal WebAuthn passkey chooser (`get`) and saver (`create`) for Bitwarden vaults,
 * always providing a one-click fallback to the system / Apple Passwords passkey dialog.
 */
export function PasskeyView({
  onConnect,
}: {
  onConnect: (vault: VaultInfo) => void
}) {
  const [prompt, setPrompt] = useState<PasskeyPromptView | null>()
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    holdPasskeyPrompt()
    callBackground("popup.passkey", null).then(setPrompt, (error) => {
      notifyError(error)
      setPrompt(null)
    })
  }, [])

  const signWith = async (option: PasskeyOption) => {
    setBusy(option.credentialId)
    try {
      await callBackground("popup.answerPasskeyGet", {
        vaultId: option.vaultId,
        loginId: option.loginId,
        credentialId: option.credentialId,
      })
      closeIfPopup()
    } catch (error) {
      notifyError(error)
    } finally {
      setBusy(null)
    }
  }

  const saveTo = async (vaultId: string, loginId: string | null) => {
    const key = `${vaultId}:${loginId ?? "new"}`
    setBusy(key)
    try {
      await callBackground("popup.answerPasskeyCreate", { vaultId, loginId })
      closeIfPopup()
    } catch (error) {
      notifyError(error)
    } finally {
      setBusy(null)
    }
  }

  const fallbackToSystem = () => {
    void callBackground("popup.fallbackPasskey", null)
      .catch(() => {})
      .finally(closeIfPopup)
  }

  if (prompt === undefined) return null
  if (prompt === null) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
        <p className="text-sm text-muted-foreground">
          {t("popup.passkey.gone")}
        </p>
        <Button variant="outline" onClick={closeIfPopup}>
          {t("common.close")}
        </Button>
      </div>
    )
  }

  const isCreate = prompt.kind === "create"
  const accountLabel = prompt.userName || prompt.userDisplayName || ""
  let subtitle = t("popup.passkey.getDesc")
  if (isCreate) {
    subtitle = accountLabel
      ? t("popup.passkey.createAccountDesc", { account: accountLabel })
      : t("popup.passkey.createDesc")
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-col gap-1.5 px-5 pt-6 pb-4">
        <div className="flex items-center gap-2">
          <FingerprintPatternIcon className="size-4 shrink-0 text-muted-foreground" />
          <h1 className="text-base leading-6 font-semibold tracking-tight break-all">
            {isCreate
              ? t("popup.passkey.createTitle", { host: prompt.rpId })
              : t("popup.passkey.getTitle", { host: prompt.rpId })}
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3">
        {!isCreate && prompt.passkeys.length > 0 && (
          <div className="flex flex-col gap-0.5">
            {prompt.passkeys.map((option) => (
              <button
                key={`${option.vaultId}:${option.credentialId}`}
                type="button"
                disabled={busy !== null}
                onClick={() => void signWith(option)}
                className="group/row flex min-h-12 w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-muted focus-visible:bg-muted disabled:cursor-wait"
              >
                <SiteIcon
                  host={option.rpId}
                  text={option.itemName}
                  className="group-hover/row:bg-background group-focus-visible/row:bg-background"
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">
                    {option.userName ||
                      option.userDisplayName ||
                      option.itemName}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {option.itemName} · {option.vaultName}
                  </span>
                </span>
                {busy === option.credentialId ? (
                  <LoaderCircleIcon className="size-4 shrink-0 animate-spin text-muted-foreground" />
                ) : (
                  <KeyRoundIcon className="size-4 shrink-0 text-muted-foreground" />
                )}
              </button>
            ))}
          </div>
        )}

        {isCreate &&
          prompt.saveTargets.map(({ vault, existingLogins }) => {
            const newKey = `${vault.id}:new`
            return (
              <section
                key={vault.id}
                aria-label={vault.label}
                className="flex flex-col gap-1"
              >
                <h2 className="flex items-center gap-1.5 px-2 pt-1 text-xs font-medium text-muted-foreground">
                  <BrandIcon kind={vault.kind} className="size-3.5" />
                  <span className="truncate">{vault.label}</span>
                </h2>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void saveTo(vault.id, null)}
                  className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-muted focus-visible:bg-muted disabled:cursor-wait"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <PlusIcon className="size-4" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">
                      {t("popup.passkey.saveAsNew")}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {accountLabel || prompt.rpName}
                    </span>
                  </span>
                  {busy === newKey && (
                    <LoaderCircleIcon className="size-4 shrink-0 animate-spin text-muted-foreground" />
                  )}
                </button>
                {existingLogins.map((login) => {
                  const attachKey = `${vault.id}:${login.id}`
                  return (
                    <button
                      key={login.id}
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void saveTo(vault.id, login.id)}
                      className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-muted focus-visible:bg-muted disabled:cursor-wait"
                    >
                      <SiteIcon host={prompt.rpId} text={login.title} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium">
                          {t("popup.passkey.attachToLogin", {
                            name: login.username || login.title,
                          })}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {login.title}
                        </span>
                      </span>
                      {busy === attachKey && (
                        <LoaderCircleIcon className="size-4 shrink-0 animate-spin text-muted-foreground" />
                      )}
                    </button>
                  )
                })}
              </section>
            )
          })}

        {prompt.lockedVaults.map((vault) => (
          <LockedVaultCard
            key={vault.id}
            vault={vault}
            onClick={() => onConnect(vault)}
          />
        ))}
      </div>

      <footer className="border-t border-border/70 p-3">
        <Button
          variant="outline"
          className="w-full"
          disabled={busy !== null}
          onClick={fallbackToSystem}
        >
          {t("popup.passkey.useSystem")}
        </Button>
      </footer>
    </div>
  )
}

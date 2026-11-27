import {
  FingerprintPatternIcon,
  KeyRoundIcon,
  RefreshCwIcon,
  SearchIcon,
  ShieldAlertIcon,
} from "lucide-react"
import type { ReactNode, RefObject } from "react"
import { FADE_IN } from "@/components/keyward/loading"
import { LoginLabel } from "@/components/keyward/login-label"
import { t } from "@/lib/i18n"
import type { PasskeyOption } from "@/lib/passkeys/types"
import { cn } from "@/lib/utils"

/** A row that fills something into the page: a login, the suggested password or a passkey. */
export function MenuRow({
  compact,
  disabled,
  busy,
  onClick,
  children,
}: {
  compact: boolean
  /** Set while any row is busy, so that one fill runs at a time. */
  disabled: boolean
  /** Whether this row's fill is running. */
  busy: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="menuitem"
      data-login
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "group/row flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-muted focus-visible:bg-muted disabled:cursor-wait",
        compact ? "min-h-9" : "min-h-12",
        busy && "bg-muted",
      )}
    >
      {children}
    </button>
  )
}

/** The square behind a row's icon, the size of a site icon. */
export function IconTile({
  compact,
  children,
}: {
  compact: boolean
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg bg-muted group-hover/row:bg-background group-focus-visible/row:bg-background",
        compact ? "size-6" : "size-8",
      )}
    >
      {children}
    </span>
  )
}

/** Confirmation card shown before filling an HTTPS-saved login onto an unencrypted HTTP page. */
export function InsecureHttpConfirm({
  host,
  disabled,
  onCancel,
  onConfirm,
}: {
  host: string
  disabled: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className={cn("flex flex-col gap-2.5 p-3", FADE_IN)}>
      <div className="flex items-start gap-2">
        <ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium">
            {t("overlay.menu.insecureHttpTitle")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("overlay.menu.insecureHttpBody", { host })}
          </p>
        </div>
      </div>
      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          disabled={disabled}
          onClick={onCancel}
          className="h-7 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
        >
          {t("overlay.menu.cancel")}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onConfirm}
          className="h-7 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {t("overlay.menu.fillAnyway")}
        </button>
      </div>
    </div>
  )
}

/** Quick filter input displayed once the menu lists enough logins to benefit from filtering. */
export function MenuFilterBar({
  value,
  onChange,
  cardRef,
}: {
  value: string
  onChange: (next: string) => void
  cardRef: RefObject<HTMLDivElement | null>
}) {
  const firstLoginButton = () =>
    cardRef.current?.querySelector<HTMLButtonElement>("button[data-login]")
  return (
    <div className="border-b border-border/60 p-1.5">
      <div className="relative flex items-center">
        <SearchIcon className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground" />
        <input
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && value) {
              event.preventDefault()
              event.stopPropagation()
              onChange("")
            } else if (event.key === "ArrowDown") {
              event.preventDefault()
              firstLoginButton()?.focus()
            } else if (event.key === "Enter") {
              event.preventDefault()
              firstLoginButton()?.click()
            }
          }}
          placeholder={t("overlay.menu.filterPlaceholder")}
          aria-label={t("overlay.menu.filterPlaceholder")}
          className="h-7 w-full rounded-md border border-input bg-background pr-2 pl-7 text-xs outline-none focus-visible:border-ring"
        />
      </div>
    </div>
  )
}

/** Generated strong password suggestion row with a regenerate action button. */
export function PasswordSuggestionRow({
  suggestion,
  compact,
  disabled,
  busy,
  onFill,
  onRegenerate,
}: {
  suggestion: string
  compact: boolean
  disabled: boolean
  busy: boolean
  onFill: () => void
  onRegenerate: () => void
}) {
  return (
    <div className="flex items-center gap-0.5 p-1">
      <div className="min-w-0 flex-1">
        <MenuRow
          compact={compact}
          disabled={disabled}
          busy={busy}
          onClick={onFill}
        >
          <IconTile compact={compact}>
            <KeyRoundIcon className="size-4" />
          </IconTile>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium">
              {t("overlay.menu.suggest")}
            </span>
            {!compact && (
              <span className="truncate font-mono text-xs text-muted-foreground">
                {suggestion}
              </span>
            )}
          </span>
        </MenuRow>
      </div>
      <button
        type="button"
        disabled={disabled}
        aria-label={t("overlay.menu.regenerate")}
        title={t("overlay.menu.regenerate")}
        onClick={onRegenerate}
        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:bg-muted disabled:opacity-50"
      >
        <RefreshCwIcon className="size-3.5" />
      </button>
    </div>
  )
}

/** Matching Bitwarden passkeys and native system / Apple Passwords passkey fallback row. */
export function PasskeyMenuSection({
  passkeys,
  compact,
  disabled,
  busyId,
  nativeBusy,
  onSignPasskey,
  onUseNative,
}: {
  passkeys: readonly PasskeyOption[]
  compact: boolean
  disabled: boolean
  busyId: string | null
  nativeBusy: boolean
  onSignPasskey: (option: PasskeyOption) => void
  onUseNative: () => void
}) {
  return (
    <div className="flex flex-col gap-0.5 border-t p-1 first:border-t-0">
      {passkeys.map((option) => (
        <MenuRow
          key={`${option.vaultId}:${option.credentialId}`}
          compact={compact}
          disabled={disabled}
          busy={busyId === `passkey:${option.credentialId}`}
          onClick={() => onSignPasskey(option)}
        >
          <IconTile compact={compact}>
            <FingerprintPatternIcon className="size-4" />
          </IconTile>
          <LoginLabel
            primary={
              option.userName || option.userDisplayName || option.itemName
            }
            detail={t("overlay.menu.passkeyFromVault", {
              vault: option.vaultName,
            })}
            compact={compact}
          />
        </MenuRow>
      ))}
      <MenuRow
        compact={compact}
        disabled={disabled}
        busy={nativeBusy}
        onClick={onUseNative}
      >
        <IconTile compact={compact}>
          <FingerprintPatternIcon className="size-4" />
        </IconTile>
        <span className="truncate text-sm font-medium">
          {passkeys.length > 0
            ? t("overlay.menu.systemPasskey")
            : t("overlay.menu.passkey")}
        </span>
      </MenuRow>
    </div>
  )
}

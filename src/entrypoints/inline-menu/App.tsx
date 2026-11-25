import {
  FingerprintPatternIcon,
  KeyRoundIcon,
  PlusIcon,
  TimerIcon,
} from "lucide-react"
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react"
import type { BackgroundApi, VaultView } from "@/background/api"
import { useAppearance } from "@/components/keyward/appearance"
import { BrandIcon, vaultLabel } from "@/components/keyward/brand-icon"
import { errorMessage } from "@/components/keyward/errors"
import { useLanguage } from "@/components/keyward/language"
import { FADE_IN, LoginListSkeleton } from "@/components/keyward/loading"
import { LoginLabel } from "@/components/keyward/login-label"
import {
  callOverlay,
  useClickGuard,
  useReportHeight,
} from "@/components/keyward/overlay-frame"
import { SiteIcon } from "@/components/keyward/site-icon"
import { Button } from "@/components/ui/button"
import { t } from "@/lib/i18n"
import { cn } from "@/lib/utils"

type MenuState = BackgroundApi["menu.state"]["result"]

/**
 * The menu under a login field. It runs inside the web page as a frame of the extension and gets
 * everything from the background, which only answers the frame that belongs to the open menu.
 */
export function App() {
  const density = useAppearance()
  const language = useLanguage()
  const card = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<MenuState | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const ids = useId()
  const headingId = (vault: VaultView) => `${ids}-${vault.id}`

  // The frame shows placeholder rows while the logins load, so it opens at once.
  useReportHeight(
    card,
    language !== null,
    (height) => void callOverlay("menu.resize", { height }).catch(() => {}),
  )

  const clickCounts = useClickGuard(card, state !== null && language !== null)
  useMenuKeyboard(card)

  useEffect(() => {
    callOverlay("menu.state", {}).then(setState, (error) => {
      setState({ host: "", kind: "login", vaults: [] })
      setMessage(errorMessage(error))
    })
  }, [])

  /** Runs a fill after a click the page could not have faked; `id` marks the row as busy. */
  const run = async (id: string, task: () => Promise<unknown>) => {
    if (!clickCounts()) {
      setMessage(t("overlay.menu.guard"))
      return
    }
    setBusy(id)
    setMessage(null)
    try {
      await task()
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }
  const fill = (vaultId: string, loginId: string) =>
    run(loginId, () => callOverlay("menu.fill", { vaultId, loginId }))
  const fillSuggestion = () =>
    run(SUGGESTION_ID, () => callOverlay("menu.fillSuggestion", {}))
  const signInWithPasskey = () =>
    run(PASSKEY_ID, () => callOverlay("menu.usePasskey", {}))

  if (!language) return null
  const allVaults = state?.vaults ?? []
  // Once one vault is open, the others are paired or unlocked from the popup instead.
  const anyReady = allVaults.some((vault) => vault.status === "ready")
  const shownVaults = allVaults.filter((vault) => {
    if (vault.status === "locked") return !anyReady
    const hasLogins = vault.logins.length > 0
    return vault.status !== "ready" || Boolean(vault.error) || hasLogins
  })
  const compact = density === "compact"
  // A lone list of logins needs no heading saying where they come from.
  const headed = shownVaults.length > 1 || Boolean(state?.suggestion)
  const isEmpty = !shownVaults.length && !message && !state?.suggestion
  const rowProps = { compact, disabled: busy !== null }

  return (
    <div className="p-2">
      <div
        ref={card}
        role="menu"
        className="flex max-h-[440px] w-full flex-col overflow-y-auto rounded-lg bg-popover pb-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none [scrollbar-width:thin]"
      >
        {state === null ? (
          <LoginListSkeleton compact={compact} heading={false} />
        ) : (
          <div className={cn("flex flex-col", FADE_IN)}>
            {state.suggestion && (
              <div className="p-1">
                <MenuRow
                  {...rowProps}
                  busy={busy === SUGGESTION_ID}
                  onClick={() => void fillSuggestion()}
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
                        {state.suggestion}
                      </span>
                    )}
                  </span>
                </MenuRow>
              </div>
            )}
            {isEmpty && (
              <p className="px-3 py-3 text-sm text-muted-foreground">
                {state.kind === "code"
                  ? t("overlay.menu.noCodes", { host: state.host })
                  : t("overlay.menu.noLogins", { host: state.host })}
              </p>
            )}
            {isEmpty && state.kind === "login" && anyReady && (
              <div className="px-1 pb-0.5">
                <button
                  type="button"
                  role="menuitem"
                  data-login
                  onClick={() =>
                    void callOverlay("menu.newLogin", {}).catch((error) =>
                      setMessage(errorMessage(error)),
                    )
                  }
                  className="flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted"
                >
                  <PlusIcon className="size-4 text-muted-foreground" />
                  {t("overlay.menu.newLogin")}
                </button>
              </div>
            )}
            {shownVaults.map((vault) =>
              vault.status !== "ready" || vault.error ? (
                <fieldset
                  key={vault.id}
                  aria-labelledby={headingId(vault)}
                  className="flex min-w-0 items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground first:pt-2"
                >
                  <VaultHeading
                    vault={vault}
                    id={headingId(vault)}
                    className="min-w-0 flex-1"
                  />
                  {vault.status === "locked" ? (
                    <Button
                      role="menuitem"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void callOverlay("menu.connect", {
                          vaultId: vault.id,
                        }).catch(() => {})
                      }
                    >
                      {vault.kind === "apple"
                        ? t("vault.pair")
                        : t("vault.unlock")}
                    </Button>
                  ) : (
                    <span className="py-1.5" title={vault.error}>
                      {vault.status === "ready"
                        ? t("vault.failed")
                        : t("vault.unavailable")}
                    </span>
                  )}
                </fieldset>
              ) : (
                <fieldset
                  key={vault.id}
                  aria-labelledby={headed ? headingId(vault) : undefined}
                  aria-label={headed ? undefined : vaultLabel(vault)}
                  className="min-w-0"
                >
                  {headed && (
                    <VaultHeading
                      vault={vault}
                      id={headingId(vault)}
                      className="px-3 pt-2.5 pb-0.5 text-xs font-medium text-muted-foreground"
                    />
                  )}
                  <div className="flex flex-col gap-0.5 p-1">
                    {vault.logins.map((login) => (
                      <MenuRow
                        key={login.id}
                        {...rowProps}
                        busy={busy === login.id}
                        onClick={() => void fill(vault.id, login.id)}
                      >
                        <SiteIcon
                          host={login.host}
                          text={login.title}
                          className={cn(
                            "group-hover/row:bg-background group-focus-visible/row:bg-background",
                            compact && "size-6",
                          )}
                        />
                        <LoginLabel
                          username={login.username}
                          detail={
                            login.recent
                              ? t("overlay.menu.recent", { site: login.title })
                              : login.title
                          }
                          compact={compact}
                        />
                        {state.kind === "code" && (
                          <TimerIcon
                            aria-label={t("overlay.menu.code")}
                            className="size-4 shrink-0 text-muted-foreground"
                          />
                        )}
                      </MenuRow>
                    ))}
                  </div>
                </fieldset>
              ),
            )}
            {state.passkey && (
              <div className="border-t p-1 first:border-t-0">
                <MenuRow
                  {...rowProps}
                  busy={busy === PASSKEY_ID}
                  onClick={() => void signInWithPasskey()}
                >
                  <IconTile compact={compact}>
                    <FingerprintPatternIcon className="size-4" />
                  </IconTile>
                  <span className="truncate text-sm font-medium">
                    {t("overlay.menu.passkey")}
                  </span>
                </MenuRow>
              </div>
            )}
            {busy && vaultOfLogin(shownVaults, busy)?.kind === "apple" && (
              <p className="px-3 pb-2 text-xs text-muted-foreground">
                {t("overlay.menu.confirmTouchId")}
              </p>
            )}
            {message && (
              <p className="px-3 pt-2 pb-2 text-xs text-destructive">
                {message}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** A row that fills something into the page: a login, the suggested password or a passkey. */
function MenuRow({
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
function IconTile({
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

/**
 * A vault's name and brand, above its logins or beside what the vault needs. It names the vault's
 * group of rows; a menu holds only rows and groups, so controls stay outside the heading.
 */
function VaultHeading({
  vault,
  id,
  className,
}: {
  vault: VaultView
  id: string
  className: string
}) {
  return (
    <h2 id={id} className={cn("flex items-center gap-1.5", className)}>
      <BrandIcon kind={vault.kind} className="size-3.5" />
      <span className="truncate">{vaultLabel(vault)}</span>
    </h2>
  )
}

/**
 * Keys reach this window once the field's content script moves the focus here on ArrowDown, and
 * the page can move it here too. Focus lands on no login until an arrow key pressed here selects
 * one, so a key meant for the page never picks a login.
 */
function useMenuKeyboard(card: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        void callOverlay("menu.close", {}).catch(() => {})
        return
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
      const rows = [
        ...(card.current?.querySelectorAll<HTMLButtonElement>(
          "button[data-login]",
        ) ?? []),
      ]
      if (!rows.length) return
      event.preventDefault()
      const index = rows.indexOf(document.activeElement as HTMLButtonElement)
      const step = event.key === "ArrowDown" ? 1 : -1
      const next =
        index < 0
          ? rows[step > 0 ? 0 : rows.length - 1]
          : rows[Math.min(Math.max(index + step, 0), rows.length - 1)]
      next?.focus()
    }
    addEventListener("keydown", onKey)
    return () => removeEventListener("keydown", onKey)
  }, [card])
}

/** The busy markers of the suggested password's and the passkey's rows; login IDs never take this form. */
const SUGGESTION_ID = "\nsuggestion"
const PASSKEY_ID = "\npasskey"

function vaultOfLogin(
  vaults: VaultView[],
  loginId: string,
): VaultView | undefined {
  return vaults.find((vault) =>
    vault.logins.some((login) => login.id === loginId),
  )
}

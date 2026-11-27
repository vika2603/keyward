import {
  ChevronRightIcon,
  FingerprintPatternIcon,
  KeyRoundIcon,
  PlusIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
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
import { connectTexts } from "@/components/keyward/connect-texts"
import { errorCodeOf, errorMessage } from "@/components/keyward/errors"
import { useLanguage } from "@/components/keyward/language"
import { FADE_IN, LoginListSkeleton } from "@/components/keyward/loading"
import { LoginLabel } from "@/components/keyward/login-label"
import {
  callOverlay,
  onOverlayFocus,
  useClickGuard,
  useReportHeight,
} from "@/components/keyward/overlay-frame"
import {
  OverlayNotice,
  useOverlayNotice,
} from "@/components/keyward/overlay-notice"
import { SiteIcon } from "@/components/keyward/site-icon"
import { openConnectPasswords } from "@/lib/connect-passwords"
import { t } from "@/lib/i18n"
import { vaultsToOffer, waitsForUser } from "@/lib/offered-vaults"
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
  const [pendingInsecure, setPendingInsecure] = useState<{
    vaultId: string
    loginId: string
  } | null>(null)
  const {
    notice,
    show: showNotice,
    dismiss: dismissNotice,
  } = useOverlayNotice()
  const ids = useId()
  const headingId = (vault: VaultView) => `${ids}-${vault.id}`

  // The frame shows placeholder rows while the logins load, so it opens at once.
  useReportHeight(
    card,
    language !== null,
    (height) => void callOverlay("menu.resize", { height }).catch(() => {}),
  )

  const ready = state !== null && language !== null
  const clickCounts = useClickGuard(card, ready)
  useMenuKeyboard(card, ready)

  useEffect(() => {
    callOverlay("menu.state", {}).then(setState, (error) => {
      setState({ host: "", kind: "login", vaults: [] })
      showNotice(errorMessage(error))
    })
  }, [showNotice])

  /** Runs a fill after a click the page could not have faked; `id` marks the row as busy. */
  const run = async (id: string, task: () => Promise<unknown>) => {
    if (!clickCounts()) {
      showNotice(t("overlay.menu.guard"))
      return
    }
    setBusy(id)
    dismissNotice()
    try {
      await task()
    } catch (error) {
      showNotice(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }
  const fill = (vaultId: string, loginId: string, confirmInsecure = false) =>
    run(loginId, async () => {
      try {
        await callOverlay("menu.fill", {
          vaultId,
          loginId,
          ...(confirmInsecure ? { confirmInsecure: true } : {}),
        })
        setPendingInsecure(null)
      } catch (error) {
        if (!confirmInsecure && errorCodeOf(error) === "insecureHttp") {
          setPendingInsecure({ vaultId, loginId })
          return
        }
        throw error
      }
    })
  const fillSuggestion = () =>
    run(SUGGESTION_ID, () => callOverlay("menu.fillSuggestion", {}))
  const regenerateSuggestion = () =>
    run(SUGGESTION_ID, async () => {
      const { suggestion } = await callOverlay("menu.regenerateSuggestion", {})
      setState((current) => (current ? { ...current, suggestion } : current))
    })
  const signInWithPasskey = () =>
    run(PASSKEY_ID, () => callOverlay("menu.usePasskey", {}))

  if (!language) return null
  const allVaults = state?.vaults ?? []
  const anyReady = allVaults.some((vault) => vault.status === "ready")
  const shownVaults = vaultsToOffer(allVaults)
  const compact = density === "compact"
  // A lone list of logins needs no heading saying where they come from.
  const headed = shownVaults.length > 1 || Boolean(state?.suggestion)
  const isEmpty = !shownVaults.length && !notice && !state?.suggestion
  const rowProps = { compact, disabled: busy !== null }

  return (
    <div className="p-2">
      <div
        ref={card}
        role="menu"
        className="flex max-h-[440px] w-full flex-col overflow-y-auto rounded-xl border border-border/80 bg-popover pb-1 text-popover-foreground shadow-md outline-none [scrollbar-width:thin]"
      >
        {state === null && (
          <LoginListSkeleton compact={compact} heading={false} />
        )}
        {state !== null && pendingInsecure && (
          <div className={cn("flex flex-col gap-2.5 p-3", FADE_IN)}>
            <div className="flex items-start gap-2">
              <ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-sm font-medium">
                  {t("overlay.menu.insecureHttpTitle")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("overlay.menu.insecureHttpBody", { host: state.host })}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-1.5">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => setPendingInsecure(null)}
                className="h-7 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
              >
                {t("overlay.menu.cancel")}
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  void fill(
                    pendingInsecure.vaultId,
                    pendingInsecure.loginId,
                    true,
                  )
                }
                className="h-7 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {t("overlay.menu.fillAnyway")}
              </button>
            </div>
          </div>
        )}
        {state !== null && !pendingInsecure && (
          <div className={cn("flex flex-col", FADE_IN)}>
            {state.embeddedInHost && (
              <div className="flex items-center gap-1.5 border-b border-border/60 px-3 py-1.5 text-xs text-muted-foreground">
                <ShieldAlertIcon className="size-3.5 shrink-0" />
                <span className="truncate">
                  {t("overlay.menu.embeddedFrame", {
                    host: state.embeddedInHost,
                  })}
                </span>
              </div>
            )}
            {state.suggestion && (
              <div className="flex items-center gap-0.5 p-1">
                <div className="min-w-0 flex-1">
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
                <button
                  type="button"
                  disabled={busy !== null}
                  aria-label={t("overlay.menu.regenerate")}
                  title={t("overlay.menu.regenerate")}
                  onClick={() => void regenerateSuggestion()}
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:bg-muted disabled:opacity-50"
                >
                  <RefreshCwIcon className="size-3.5" />
                </button>
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
                      showNotice(errorMessage(error)),
                    )
                  }
                  className="flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted"
                >
                  <PlusIcon className="size-4 text-muted-foreground" />
                  {t("overlay.menu.newLogin")}
                </button>
              </div>
            )}
            {shownVaults.map((vault) => {
              if (waitsForUser(vault))
                return (
                  <fieldset
                    key={vault.id}
                    aria-label={vaultLabel(vault)}
                    className="min-w-0 p-1"
                  >
                    <ConnectRow
                      vault={vault}
                      disabled={busy !== null}
                      onClick={() => connect(vault)}
                    />
                  </fieldset>
                )
              return vault.status !== "ready" || vault.error ? (
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
                  <span className="py-1.5" title={vault.error}>
                    {vault.status === "ready"
                      ? t("vault.failed")
                      : t("vault.unavailable")}
                  </span>
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
                          primary={login.username}
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
              )
            })}
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
            <div className="px-1 pt-1 empty:hidden">
              <OverlayNotice notice={notice} onDismiss={dismissNotice} />
            </div>
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

/**
 * The row of a vault that needs the user before it lists logins. It keeps the full size whatever
 * the density, since it usually stands alone in the menu.
 */
function ConnectRow({
  vault,
  disabled,
  onClick,
}: {
  vault: VaultView
  disabled: boolean
  onClick: () => void
}) {
  const { title, detail } = connectTexts(vault)
  return (
    <MenuRow compact={false} disabled={disabled} busy={false} onClick={onClick}>
      <IconTile compact={false}>
        <BrandIcon kind={vault.kind} className="size-4" />
      </IconTile>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{title}</span>
        <span className="truncate text-xs text-muted-foreground">{detail}</span>
      </span>
      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
    </MenuRow>
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
 * Focuses the first row when the content script hands focus here on ArrowDown (proven by the
 * session token, so a page calling `iframe.focus()` selects nothing), and returns focus to the
 * field on Escape or ArrowUp from the top row.
 */
function useMenuKeyboard(
  card: RefObject<HTMLElement | null>,
  ready: boolean,
): void {
  const pendingFocus = useRef(false)
  const rowsOf = () => [
    ...(card.current?.querySelectorAll<HTMLButtonElement>(
      "button[data-login]",
    ) ?? []),
  ]

  // biome-ignore lint/correctness/useExhaustiveDependencies: `rowsOf` reads the ref's current DOM.
  useEffect(() => {
    if (!ready || !pendingFocus.current) return
    pendingFocus.current = false
    const first = rowsOf()[0]
    if (first) first.focus()
    else void callOverlay("menu.focusField", {}).catch(() => {})
  }, [ready])

  // biome-ignore lint/correctness/useExhaustiveDependencies: `rowsOf` reads the ref's current DOM, and `ready` is read through a ref.
  useEffect(() => {
    return onOverlayFocus(() => {
      const first = rowsOf()[0]
      if (first) {
        pendingFocus.current = false
        first.focus()
      } else {
        pendingFocus.current = true
      }
    })
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: `rowsOf` reads the ref's current DOM.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing) return
      if (event.key === "Escape") {
        event.preventDefault()
        void callOverlay("menu.close", { focusField: true }).catch(() => {})
        return
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
      const rows = rowsOf()
      if (!rows.length) {
        if (event.key === "ArrowUp") {
          event.preventDefault()
          void callOverlay("menu.focusField", {}).catch(() => {})
        }
        return
      }
      event.preventDefault()
      const index = rows.indexOf(document.activeElement as HTMLButtonElement)
      if (event.key === "ArrowUp" && index === 0) {
        rows[0]?.blur()
        void callOverlay("menu.focusField", {}).catch(() => {})
        return
      }
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

/**
 * Setup runs a Terminal command, so it opens in a tab of its own; pairing and unlocking open the
 * popup on the vault.
 */
function connect(vault: VaultView): void {
  if (!vault.needsSetup) {
    // The background closes the menu as it opens the popup.
    void callOverlay("menu.connect", { vaultId: vault.id }).catch(() => {})
    return
  }
  void openConnectPasswords()
  void callOverlay("menu.close", {}).catch(() => {})
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

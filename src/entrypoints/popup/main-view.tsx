import {
  CheckIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  LockIcon,
  PlusIcon,
  RefreshCcwDotIcon,
  SearchIcon,
  TimerIcon,
  UserIcon,
  XIcon,
} from "lucide-react"
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react"
import keywardIcon from "@/assets/icon.svg"
import {
  callBackground,
  type PageInfo,
  type SourceView,
} from "@/background/api"
import {
  BrandIcon,
  backendName,
  sourceLabel,
} from "@/components/keyward/brand-icon"
import { errorMessage } from "@/components/keyward/errors"
import { FADE_IN, LoginListSkeleton } from "@/components/keyward/loading"
import { LoginLabel } from "@/components/keyward/login-label"
import { SiteIcon } from "@/components/keyward/site-icon"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type {
  BackendKind,
  LoginSummary,
  SourceInfo,
} from "@/lib/backends/types"
import { t } from "@/lib/i18n"
import type { Settings } from "@/lib/settings"
import { cn } from "@/lib/utils"
import type { View } from "./App"
import { ConnectCard, LockedSourceCard } from "./connect-card"
import { openOptions, SettingsButton } from "./header"

type Filter = "all" | BackendKind

/** A search waits for typing to pause this long. */
const SEARCH_DELAY_MS = 150

export function MainView({
  density,
  query,
  onQuery,
  onNavigate,
}: {
  density: Settings["density"]
  /** Searches the whole vault while not empty; the page's logins show otherwise. */
  query: string
  onQuery: (query: string) => void
  onNavigate: (view: View) => void
}) {
  const [state, setState] = useState<{
    page: PageInfo | null
    sources: SourceView[]
  } | null>(null)
  const [results, setResults] = useState<SourceView[] | null>(null)
  /** Changes after a lock, so the search runs again. */
  const [version, setVersion] = useState(0)
  const [filter, setFilter] = useState<Filter>("all")
  const [message, setMessage] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  /** The rows' buttons that open a login, in list order; arrow keys move between them. */
  const rows = () => [
    ...(listRef.current?.querySelectorAll<HTMLButtonElement>("[data-row]") ??
      []),
  ]

  const load = useCallback(() => {
    callBackground("popup.state", null).then(setState, (error) =>
      setMessage(errorMessage(error)),
    )
    setVersion((v) => v + 1)
  }, [])
  useEffect(load, [load])

  // Nothing can be searched or filtered until a source is ready; the view offers to connect instead.
  const connected = state?.sources.some((s) => s.status === "ready") ?? false
  const search = connected ? query.trim() : ""
  useEffect(() => {
    setResults(null)
    if (!search || version < 1) return
    let stale = false
    const timer = setTimeout(() => {
      callBackground("popup.search", { query: search }).then(
        (found) => !stale && setResults(found),
        (error) => !stale && setMessage(errorMessage(error)),
      )
    }, SEARCH_DELAY_MS)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [search, version])

  const loading = state === null
  const page = state?.page ?? null
  const sources = state?.sources ?? []
  const kinds = new Set(sources.map((s) => s.kind))
  const anyReady = sources.some((s) => s.status === "ready")
  const lockAll = async () => {
    setMessage(null)
    try {
      await callBackground("popup.lockAll", null)
    } catch (error) {
      setMessage(errorMessage(error))
    }
    load()
  }
  const shown = (search ? (results ?? []) : sources).filter(
    (s) => filter === "all" || s.kind === filter,
  )
  const tabs = connected && kinds.size > 1
  // Sources to pair or unlock get a large button each, except on the "all" tab once one is open:
  // each is then unlocked from its own tab. The others list their logins or say why they cannot.
  const locked =
    filter === "all" && tabs ? [] : shown.filter((s) => s.status === "locked")
  // Whether the sources in view can say a site has no logins, or take a new one.
  const shownReady = shown.some((s) => s.status === "ready")
  const listed = shown.filter(
    (s) =>
      s.status !== "locked" &&
      (s.status !== "ready" || s.error || s.logins.length),
  )
  const lockedCards = locked.map((source) => (
    <LockedSourceCard
      key={source.id}
      source={source}
      onClick={() =>
        onNavigate({ name: "connect", kind: source.kind, sourceId: source.id })
      }
    />
  ))
  // Apple's helper looks logins up by site only, so a search for other text cannot reach it.
  const appleSearchHint =
    search !== "" &&
    !search.includes(".") &&
    shown.some((s) => s.kind === "apple" && s.status === "ready")

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 py-2 pr-2 pl-3">
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">Keyward</h1>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("popup.add.title")}
          title={t("popup.add.title")}
          onClick={() => onNavigate({ name: "add" })}
        >
          <PlusIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("popup.generator.title")}
          title={t("popup.generator.title")}
          onClick={() => onNavigate({ name: "generator" })}
        >
          <RefreshCcwDotIcon />
        </Button>
        {/* Disabled rather than hidden once all is locked, so the buttons beside it stay put. */}
        {(loading || sources.length > 0) && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("popup.main.lockAll")}
            title={t("popup.main.lockAll")}
            disabled={!anyReady}
            onClick={() => void lockAll()}
          >
            <LockIcon />
          </Button>
        )}
        <SettingsButton />
      </div>
      {(loading || connected) && (
        <div className="relative px-2 pb-2">
          <SearchIcon className="pointer-events-none absolute top-2 left-4.5 size-4 text-muted-foreground" />
          <Input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={(event) => {
              // While an input method composes text, Enter, Escape and the arrows belong to it.
              if (event.nativeEvent.isComposing) return
              // Escape clears a search before it closes the popup.
              if (event.key === "Escape" && query) {
                event.preventDefault()
                onQuery("")
              } else if (event.key === "ArrowDown") {
                event.preventDefault()
                rows()[0]?.focus()
              } else if (event.key === "Enter") {
                rows()[0]?.click()
              }
            }}
            placeholder={t("popup.main.search")}
            aria-label={t("popup.main.search")}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            className="pr-8 pl-8 [&::-webkit-search-cancel-button]:appearance-none"
          />
          {query && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="absolute top-1 right-3.5 text-muted-foreground"
              aria-label={t("popup.main.clearSearch")}
              title={t("popup.main.clearSearch")}
              onClick={() => {
                onQuery("")
                searchRef.current?.focus()
              }}
            >
              <XIcon />
            </Button>
          )}
        </div>
      )}
      {tabs && (
        <div className="px-2 pb-2">
          <Tabs
            value={filter}
            onValueChange={(value) => setFilter(value as Filter)}
          >
            <TabsList className="w-full">
              <TabsTrigger value="all">{t("popup.main.all")}</TabsTrigger>
              {(["apple", "bitwarden"] as const).map((kind) => (
                <TabsTrigger key={kind} value={kind}>
                  <BrandIcon kind={kind} />
                  {backendName(kind)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      )}
      {(loading || connected) && <Separator />}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: arrow keys move between the rows' buttons, which take the focus. */}
      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto pb-1"
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
          const list = rows()
          const index = list.indexOf(event.target as HTMLButtonElement)
          if (index < 0) return
          event.preventDefault()
          const next = index + (event.key === "ArrowDown" ? 1 : -1)
          if (next < 0) searchRef.current?.focus()
          else list[Math.min(next, list.length - 1)]?.focus()
        }}
      >
        {message && (
          <p className="px-3 pt-2 text-xs text-destructive">{message}</p>
        )}
        {loading || (search && results === null) ? (
          !message && <LoginListSkeleton compact={density === "compact"} />
        ) : !sources.length ? (
          <EmptyState icon text={t("popup.main.noBackend")}>
            <ConnectCard
              kind="apple"
              title={t("popup.main.pairApple")}
              detail={t("popup.main.pairAppleDetail")}
              onClick={() => onNavigate({ name: "connect", kind: "apple" })}
            />
            <ConnectCard
              kind="bitwarden"
              title={t("popup.main.signInBitwarden")}
              onClick={() => openOptions("onboard")}
            />
          </EmptyState>
        ) : !listed.length ? (
          <EmptyState
            icon={!anyReady}
            text={
              search
                ? t("popup.main.noResults", { query: search })
                : !shownReady
                  ? t("popup.main.connectHint")
                  : page
                    ? t("popup.main.noLogins", { host: page.host })
                    : t("popup.main.notWebPage")
            }
          >
            {lockedCards}
            {appleSearchHint && (
              <p className="text-xs text-muted-foreground">
                {t("popup.main.appleSearchHint")}
              </p>
            )}
            {shownReady && !search && (
              <Button
                variant="outline"
                className="self-center"
                onClick={() => onNavigate({ name: "add" })}
              >
                <PlusIcon />
                {t("popup.add.title")}
              </Button>
            )}
          </EmptyState>
        ) : (
          <div className={FADE_IN}>
            {listed.map((source) => (
              <SourceGroup
                key={source.id}
                source={source}
                density={density}
                onLocked={load}
                onOpen={(login) =>
                  onNavigate({ name: "detail", source, login })
                }
                onError={setMessage}
              />
            ))}
            {appleSearchHint && (
              <p className="px-3 pt-2 pb-1 text-xs text-muted-foreground">
                {t("popup.main.appleSearchHint")}
              </p>
            )}
            {lockedCards.length > 0 && (
              <div className="flex flex-col gap-2 px-3 pt-3 pb-2">
                {lockedCards}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** A centred message in the list area, with the actions that follow from it below. */
function EmptyState({
  text,
  icon = false,
  children,
}: {
  text: string
  /** Shows Keyward's icon above, for the views before anything is connected. */
  icon?: boolean
  children?: ReactNode
}) {
  return (
    <div className="flex h-full flex-col items-stretch justify-center gap-4 px-4 pb-12 text-center">
      {icon && (
        <img
          src={keywardIcon}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="mb-1 size-14 self-center rounded-2xl"
        />
      )}
      <p className="text-sm text-muted-foreground">{text}</p>
      {children}
    </div>
  )
}

function SourceGroup({
  source,
  density,
  onLocked,
  onOpen,
  onError,
}: {
  source: SourceView
  density: Settings["density"]
  onLocked: () => void
  onOpen: (login: LoginSummary) => void
  onError: (message: string | null) => void
}) {
  const [open, setOpen] = useState(true)

  const lock = async () => {
    onError(null)
    try {
      await callBackground("popup.lock", { sourceId: source.id })
    } catch (error) {
      onError(errorMessage(error))
    }
    onLocked()
  }

  if (source.status !== "ready" || source.error) {
    return (
      <section>
        <h2 className="flex items-center gap-1.5 px-3 pt-1.5 pb-0.5 text-xs font-medium text-muted-foreground">
          <BrandIcon kind={source.kind} className="size-3.5" />
          <span className="min-w-0 flex-1 truncate">{sourceLabel(source)}</span>
          <span className="py-1.5" title={source.error}>
            {source.status === "ready"
              ? t("source.failed")
              : t("source.unavailable")}
          </span>
        </h2>
      </section>
    )
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} render={<section />}>
      {/* The chevron stays last and the lock, which every group has, next to it, so both line up
          across groups; the Apple group's extra button sits further left. */}
      <h2 className="flex items-center gap-0.5 pt-1.5 pr-1.5">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch px-3 text-left text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
          <BrandIcon kind={source.kind} className="size-3.5" />
          <span className="min-w-0 truncate">{sourceLabel(source)}</span>
        </CollapsibleTrigger>
        {source.kind === "apple" && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            aria-label={t("popup.main.openPasswordsApp")}
            title={t("popup.main.openPasswordsApp")}
            onClick={() =>
              void callBackground("apple.openPasswordsApp", {}).catch((error) =>
                onError(errorMessage(error)),
              )
            }
          >
            <ExternalLinkIcon />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground"
          aria-label={
            source.kind === "apple"
              ? t("popup.main.lockApple")
              : t("popup.main.lock")
          }
          title={
            source.kind === "apple"
              ? t("popup.main.lockApple")
              : t("popup.main.lock")
          }
          onClick={() => void lock()}
        >
          <LockIcon />
        </Button>
        {/* The label above is the keyboard's way to toggle; this is a second target for the pointer. */}
        {/* Not a ghost Button: that one keeps a grey fill while it is expanded. */}
        <CollapsibleTrigger
          tabIndex={-1}
          aria-label={t("popup.main.toggleGroup")}
          title={t("popup.main.toggleGroup")}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground [&_svg]:size-3"
        >
          <ChevronDownIcon
            className={cn("transition-transform", !open && "-rotate-90")}
          />
        </CollapsibleTrigger>
      </h2>
      <CollapsibleContent>
        <div className="flex flex-col gap-0.5 p-1">
          {source.logins.map((login) => (
            <LoginRow
              key={login.id}
              source={source}
              login={login}
              density={density}
              onOpen={() => onOpen(login)}
              onError={onError}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

type Copyable = "username" | "password" | "code"

function LoginRow({
  source,
  login,
  density,
  onOpen,
  onError,
}: {
  source: SourceInfo
  login: LoginSummary
  density: Settings["density"]
  onOpen: () => void
  onError: (message: string | null) => void
}) {
  const [copied, setCopied] = useState<Copyable | null>(null)
  // Apple asks for Touch ID before it hands out a password; the row says so meanwhile.
  const [confirming, setConfirming] = useState(false)
  const compact = density === "compact"
  const ids = { sourceId: source.id, loginId: login.id }

  const copy = async (what: Copyable) => {
    onError(null)
    if (what === "password" && source.kind === "apple") setConfirming(true)
    try {
      if (what === "username")
        await callBackground("popup.copyText", { text: login.username })
      else if (what === "password")
        await callBackground("popup.copyPassword", ids)
      else {
        const { code } = await callBackground("popup.oneTimeCode", ids)
        await callBackground("popup.copyText", { text: code, secret: true })
      }
      setCopied(what)
      setTimeout(() => setCopied(null), 1500)
    } catch (error) {
      onError(errorMessage(error))
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div
      className={cn(
        "group/row flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-muted focus-within:bg-muted",
        compact ? "min-h-9" : "min-h-12",
      )}
    >
      <button
        type="button"
        title={t("popup.main.viewDetails")}
        data-row
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2.5 self-stretch text-left outline-none"
      >
        <SiteIcon
          host={login.host}
          text={login.title}
          className={cn(
            "group-hover/row:bg-background group-focus-within/row:bg-background",
            compact && "size-6",
          )}
        />
        <LoginLabel
          username={login.username}
          detail={confirming ? t("popup.main.confirmTouchId") : login.title}
          compact={compact}
        />
      </button>
      <div
        className={cn(
          "flex shrink-0 gap-0.5 opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100",
          confirming && "opacity-100",
        )}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          className="hover:bg-background"
          aria-label={t("popup.copyUsername")}
          title={t("popup.copyUsername")}
          onClick={() => void copy("username")}
        >
          {copied === "username" ? <CheckIcon /> : <UserIcon />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="hover:bg-background"
          aria-label={t("popup.copyPassword")}
          title={t("popup.copyPassword")}
          onClick={() => void copy("password")}
        >
          {copied === "password" ? <CheckIcon /> : <KeyRoundIcon />}
        </Button>
        {login.hasCode && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="hover:bg-background"
            aria-label={t("popup.copyCode")}
            title={t("popup.copyCode")}
            onClick={() => void copy("code")}
          >
            {copied === "code" ? <CheckIcon /> : <TimerIcon />}
          </Button>
        )}
      </div>
    </div>
  )
}

import {
  CheckIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  LockIcon,
  PlusIcon,
  RefreshCcwDotIcon,
  TimerIcon,
  UserIcon,
} from "lucide-react"
import { useCallback, useEffect, useState } from "react"
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
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
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
import { openOptions, SettingsButton } from "./header"

type Filter = "all" | BackendKind

export function MainView({
  density,
  onNavigate,
}: {
  density: Settings["density"]
  onNavigate: (view: View) => void
}) {
  const [state, setState] = useState<{
    page: PageInfo | null
    sources: SourceView[]
  } | null>(null)
  const [filter, setFilter] = useState<Filter>("all")
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(() => {
    callBackground("popup.state", null).then(setState, (error) =>
      setMessage(errorMessage(error)),
    )
  }, [])
  useEffect(load, [load])

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
  const shown = sources.filter((s) => filter === "all" || s.kind === filter)
  const groups = shown.filter(
    (s) => s.status !== "ready" || s.error || s.logins.length,
  )

  return (
    <div className="flex max-h-[600px] flex-col">
      <div className="flex items-center gap-1 py-2 pr-2 pl-3">
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">
          {loading ? (
            <Skeleton className="h-4 w-32" />
          ) : (
            (page?.host ?? "Keyward")
          )}
        </h1>
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
      {kinds.size > 1 && (
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
      <Separator />
      <div className="min-h-0 flex-1 overflow-y-auto pb-1">
        {message && (
          <p className="px-3 pt-2 text-xs text-destructive">{message}</p>
        )}
        {loading ? (
          !message && <LoginListSkeleton compact={density === "compact"} />
        ) : !sources.length ? (
          <div className="flex flex-col items-center gap-3 px-3 py-12 text-center">
            <p className="text-sm text-muted-foreground">
              {t("popup.main.noBackend")}
            </p>
            <Button onClick={() => openOptions("onboard")}>
              {t("popup.main.connect")}
            </Button>
          </div>
        ) : !groups.length ? (
          <div className="flex flex-col items-center gap-3 px-3 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              {page
                ? t("popup.main.noLogins", { host: page.host })
                : t("popup.main.notWebPage")}
            </p>
            <Button
              variant="outline"
              onClick={() => onNavigate({ name: "add" })}
            >
              <PlusIcon />
              {t("popup.add.title")}
            </Button>
          </div>
        ) : (
          <div className={FADE_IN}>
            {groups.map((source) => (
              <SourceGroup
                key={source.id}
                source={source}
                density={density}
                onLocked={load}
                onConnect={() =>
                  onNavigate({
                    name: "connect",
                    kind: source.kind,
                    sourceId: source.id,
                  })
                }
                onOpen={(login) =>
                  onNavigate({ name: "detail", source, login })
                }
                onError={setMessage}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SourceGroup({
  source,
  density,
  onLocked,
  onConnect,
  onOpen,
  onError,
}: {
  source: SourceView
  density: Settings["density"]
  onLocked: () => void
  onConnect: () => void
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
          {source.status === "locked" ? (
            <Button variant="outline" size="sm" onClick={onConnect}>
              {source.kind === "apple" ? t("source.pair") : t("source.unlock")}
            </Button>
          ) : (
            <span className="py-1.5" title={source.error}>
              {source.status === "ready"
                ? t("source.failed")
                : t("source.unavailable")}
            </span>
          )}
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
        <CollapsibleTrigger
          tabIndex={-1}
          aria-label={t("popup.main.toggleGroup")}
          title={t("popup.main.toggleGroup")}
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
            />
          }
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

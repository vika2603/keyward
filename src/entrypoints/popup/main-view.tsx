import {
  CheckIcon,
  ChevronDownIcon,
  KeyRoundIcon,
  PlusIcon,
  RefreshCcwDotIcon,
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
import { LoginLabel } from "@/components/keyward/login-label"
import { SiteIcon } from "@/components/keyward/site-icon"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { BackendKind, LoginSummary } from "@/lib/backends/types"
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

  if (!state) return <div className="h-[316px]" />
  const { page, sources } = state
  const kinds = new Set(sources.map((s) => s.kind))
  const shown = sources.filter((s) => filter === "all" || s.kind === filter)
  const groups = shown.filter(
    (s) => s.status !== "ready" || s.error || s.logins.length,
  )

  return (
    <div className="flex max-h-[600px] min-h-[316px] flex-col">
      <div className="flex items-center gap-1 py-2 pr-2 pl-3">
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">
          {page?.host ?? "Keyward"}
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
        {!sources.length ? (
          <div className="flex flex-col items-center gap-3 px-3 pt-14 text-center">
            <p className="text-sm text-muted-foreground">
              {t("popup.main.noBackend")}
            </p>
            <Button onClick={() => openOptions("onboard")}>
              {t("popup.main.connect")}
            </Button>
          </div>
        ) : !groups.length ? (
          <div className="flex flex-col items-center gap-3 px-3 pt-10 text-center">
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
          groups.map((source) => (
            <SourceGroup
              key={source.id}
              source={source}
              density={density}
              onConnect={() =>
                onNavigate({
                  name: "connect",
                  kind: source.kind,
                  sourceId: source.id,
                })
              }
              onError={setMessage}
            />
          ))
        )}
      </div>
    </div>
  )
}

function SourceGroup({
  source,
  density,
  onConnect,
  onError,
}: {
  source: SourceView
  density: Settings["density"]
  onConnect: () => void
  onError: (message: string | null) => void
}) {
  const [open, setOpen] = useState(true)

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
      <h2>
        <CollapsibleTrigger className="group/trigger flex w-full items-center gap-1.5 px-3 pt-2.5 pb-0.5 text-left text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
          <BrandIcon kind={source.kind} className="size-3.5" />
          <span className="min-w-0 truncate">{sourceLabel(source)}</span>
          <ChevronDownIcon className="ml-auto size-3.5 transition-transform group-data-[panel-open]/trigger:rotate-0 -rotate-90" />
        </CollapsibleTrigger>
      </h2>
      <CollapsibleContent>
        <div className="flex flex-col gap-0.5 p-1">
          {source.logins.map((login) => (
            <LoginRow
              key={login.id}
              sourceId={source.id}
              kind={source.kind}
              login={login}
              density={density}
              onError={onError}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function LoginRow({
  sourceId,
  kind,
  login,
  density,
  onError,
}: {
  sourceId: string
  kind: BackendKind
  login: LoginSummary
  density: Settings["density"]
  onError: (message: string | null) => void
}) {
  const [copied, setCopied] = useState<"username" | "password" | null>(null)
  // Apple asks for Touch ID before it hands out a password; the row says so meanwhile.
  const [confirming, setConfirming] = useState(false)
  const compact = density === "compact"

  const copy = async (what: "username" | "password") => {
    onError(null)
    if (what === "password" && kind === "apple") setConfirming(true)
    try {
      if (what === "username")
        await callBackground("popup.copyText", { text: login.username })
      else
        await callBackground("popup.copyPassword", {
          sourceId,
          loginId: login.id,
        })
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
      </div>
    </div>
  )
}

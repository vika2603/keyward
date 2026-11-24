import {
  CheckIcon,
  ChevronDownIcon,
  Dice3Icon,
  KeyRoundIcon,
  PlusIcon,
  UserIcon,
} from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import {
  callBackground,
  type PageInfo,
  type SourceView,
} from "@/background/api"
import { BACKEND_NAMES, BrandIcon } from "@/components/keyward/brand-icon"
import { errorMessage } from "@/components/keyward/errors"
import { SiteLetter } from "@/components/keyward/site-letter"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { BackendKind, LoginSummary } from "@/lib/backends/types"
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
  const groups = shown.filter((s) => s.status !== "ready" || s.logins.length)

  return (
    <div className="flex max-h-[600px] min-h-[316px] flex-col">
      <div className="flex items-center gap-1 py-2 pr-2 pl-3">
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">
          {page?.host ?? "Keyward"}
        </h1>
        <Button
          variant="ghost"
          size="icon"
          aria-label="添加密码"
          title="添加密码"
          onClick={() => onNavigate({ name: "add" })}
        >
          <PlusIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="密码生成器"
          title="密码生成器"
          onClick={() => onNavigate({ name: "generator" })}
        >
          <Dice3Icon />
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
              <TabsTrigger value="all">全部</TabsTrigger>
              {(["apple", "bitwarden"] as const).map((kind) => (
                <TabsTrigger key={kind} value={kind}>
                  <BrandIcon kind={kind} />
                  {BACKEND_NAMES[kind]}
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
            <p className="text-sm text-muted-foreground">还没有连接密码后端</p>
            <Button onClick={() => openOptions("onboard")}>连接后端</Button>
          </div>
        ) : !groups.length ? (
          <div className="flex flex-col items-center gap-3 px-3 pt-10 text-center">
            <p className="text-sm text-muted-foreground">
              {page ? `没有 ${page.host} 的密码` : "当前页面不是网页"}
            </p>
            <Button
              variant="outline"
              onClick={() => onNavigate({ name: "add" })}
            >
              <PlusIcon />
              添加密码
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

  if (source.status !== "ready") {
    return (
      <section>
        <h2 className="flex items-center gap-1.5 px-3 pt-1.5 pb-0.5 text-xs font-medium text-muted-foreground">
          <BrandIcon kind={source.kind} className="size-3.5" />
          <span className="min-w-0 flex-1 truncate">{source.label}</span>
          {source.status === "locked" ? (
            <Button variant="outline" size="sm" onClick={onConnect}>
              {source.kind === "apple" ? "配对" : "解锁"}
            </Button>
          ) : (
            <span className="py-1.5" title={source.error}>
              不可用
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
          <span className="min-w-0 truncate">{source.label}</span>
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
      <SiteLetter
        text={login.title}
        className={cn(
          "group-hover/row:bg-background group-focus-within/row:bg-background",
          compact && "size-6",
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">
          {login.username || "（无用户名）"}
        </span>
        {confirming ? (
          <span className="truncate text-xs text-muted-foreground">
            用触控 ID 或 Mac 密码确认
          </span>
        ) : (
          !compact && (
            <span className="truncate text-xs text-muted-foreground">
              {login.title}
            </span>
          )
        )}
      </div>
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
          aria-label="复制账号"
          title="复制账号"
          onClick={() => void copy("username")}
        >
          {copied === "username" ? <CheckIcon /> : <UserIcon />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="hover:bg-background"
          aria-label="复制密码"
          title="复制密码"
          onClick={() => void copy("password")}
        >
          {copied === "password" ? <CheckIcon /> : <KeyRoundIcon />}
        </Button>
      </div>
    </div>
  )
}

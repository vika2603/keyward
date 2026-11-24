import { type KeyboardEvent, useEffect, useRef, useState } from "react"
import type { SourceView } from "@/background/api"
import { useAppearance } from "@/components/keyward/appearance"
import { BrandIcon } from "@/components/keyward/brand-icon"
import { errorMessage } from "@/components/keyward/errors"
import {
  callOverlay,
  useClickGuard,
  useReportHeight,
} from "@/components/keyward/overlay-frame"
import { SiteLetter } from "@/components/keyward/site-letter"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * The menu under a login field. It runs inside the web page as a frame of the extension and gets
 * everything from the background, which only answers the frame that belongs to the open menu.
 */
export function App() {
  const density = useAppearance()
  const card = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<{
    host: string
    sources: SourceView[]
  } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useReportHeight(
    card,
    state !== null,
    (height) => void callOverlay("menu.resize", { height }).catch(() => {}),
  )

  const clickCounts = useClickGuard(card, state !== null)

  useEffect(() => {
    callOverlay("menu.state", {}).then(setState, (error) => {
      setState({ host: "", sources: [] })
      setMessage(errorMessage(error))
    })
    const close = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape")
        void callOverlay("menu.close", {}).catch(() => {})
    }
    // The field's content script moves the focus into this frame on ArrowDown, and so can the page.
    // The card takes it rather than a login, so that only a key pressed here selects one.
    const focusCard = () => {
      if (!card.current?.contains(document.activeElement)) card.current?.focus()
    }
    addEventListener("keydown", close)
    addEventListener("focus", focusCard)
    return () => {
      removeEventListener("keydown", close)
      removeEventListener("focus", focusCard)
    }
  }, [])

  const fill = async (sourceId: string, loginId: string) => {
    if (!clickCounts()) {
      setMessage("菜单刚出现、移动过或被页面遮挡，没有填入。请再选一次。")
      return
    }
    setBusy(loginId)
    setMessage(null)
    try {
      await callOverlay("menu.fill", { sourceId, loginId })
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
    const buttons = [
      ...(card.current?.querySelectorAll<HTMLButtonElement>(
        "button[data-login]",
      ) ?? []),
    ]
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = buttons[index + (event.key === "ArrowDown" ? 1 : -1)]
    if (next) {
      event.preventDefault()
      next.focus()
    }
  }

  if (!state) return null
  const sources = state.sources.filter(
    (s) => s.status === "locked" || s.logins.length,
  )
  const compact = density === "compact"

  return (
    <div className="p-2">
      <div
        ref={card}
        role="menu"
        tabIndex={-1}
        onKeyDown={moveFocus}
        className="flex max-h-[440px] w-[340px] flex-col overflow-y-auto rounded-lg bg-popover pb-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none [scrollbar-width:thin]"
      >
        {!sources.length && !message && (
          <p className="px-3 py-3 text-sm text-muted-foreground">
            没有 {state.host} 的密码
          </p>
        )}
        {sources.map((source) =>
          source.status === "locked" ? (
            <h2
              key={source.id}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground first:pt-2"
            >
              <BrandIcon kind={source.kind} className="size-3.5" />
              <span className="min-w-0 flex-1 truncate">{source.label}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void callOverlay("menu.connect", {
                    sourceId: source.id,
                  }).catch(() => {})
                }
              >
                {source.kind === "apple" ? "配对" : "解锁"}
              </Button>
            </h2>
          ) : (
            <section key={source.id}>
              <h2 className="flex items-center gap-1.5 px-3 pt-2.5 pb-0.5 text-xs font-medium text-muted-foreground">
                <BrandIcon kind={source.kind} className="size-3.5" />
                <span className="truncate">{source.label}</span>
              </h2>
              <div className="flex flex-col gap-0.5 p-1">
                {source.logins.map((login) => (
                  <button
                    key={login.id}
                    type="button"
                    role="menuitem"
                    data-login
                    disabled={busy !== null}
                    onClick={() => void fill(source.id, login.id)}
                    className={cn(
                      "group/row flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-muted focus-visible:bg-muted disabled:cursor-wait",
                      compact ? "min-h-9" : "min-h-12",
                      busy === login.id && "bg-muted",
                    )}
                  >
                    <SiteLetter
                      text={login.title}
                      className={cn(
                        "group-hover/row:bg-background group-focus-visible/row:bg-background",
                        compact && "size-6",
                      )}
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">
                        {login.username || "（无用户名）"}
                      </span>
                      {!compact && (
                        <span className="truncate text-xs text-muted-foreground">
                          {login.title}
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ),
        )}
        {busy && source(sources, busy)?.kind === "apple" && (
          <p className="px-3 pb-2 text-xs text-muted-foreground">
            用触控 ID 或 Mac 密码确认。
          </p>
        )}
        {message && (
          <p className="px-3 pt-2 pb-2 text-xs text-destructive">{message}</p>
        )}
      </div>
    </div>
  )
}

function source(
  sources: SourceView[],
  loginId: string,
): SourceView | undefined {
  return sources.find((s) => s.logins.some((l) => l.id === loginId))
}

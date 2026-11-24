import { XIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { PromptState } from "@/background/api"
import { useAppearance } from "@/components/keyward/appearance"
import { BrandIcon } from "@/components/keyward/brand-icon"
import { errorMessage } from "@/components/keyward/errors"
import {
  callOverlay,
  useClickGuard,
  useReportHeight,
} from "@/components/keyward/overlay-frame"
import { SiteLetter } from "@/components/keyward/site-letter"
import { SourceSelect } from "@/components/keyward/source-select"
import { Button } from "@/components/ui/button"

/** Asks to save or update a login after the user signed in; shown at the top right of the page. */
export function App() {
  useAppearance()
  const card = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<PromptState | null>(null)
  const [target, setTarget] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useReportHeight(
    card,
    state !== null,
    (height) => void callOverlay("prompt.resize", { height }).catch(() => {}),
  )
  const clickCounts = useClickGuard(card, state !== null)
  const guarded = (action: () => void) => () => {
    if (clickCounts()) action()
    else setMessage("提示刚出现、移动过或被页面遮挡，请再点一次。")
  }

  useEffect(() => {
    callOverlay("prompt.state", {}).then(
      (next) => {
        setState(next)
        setTarget(next.defaultTarget)
      },
      () => void callOverlay("prompt.close", {}).catch(() => {}),
    )
  }, [])

  const confirm = async () => {
    if (!clickCounts()) {
      setMessage("提示刚出现、移动过或被页面遮挡，请再点一次。")
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      await callOverlay("prompt.confirm", { targetId: target })
    } catch (error) {
      setMessage(errorMessage(error))
      setBusy(false)
    }
  }

  const update = state?.mode === "update"
  const appleTarget = update
    ? state?.updateSource?.kind === "apple"
    : state?.targets.find((t) => t.id === target)?.kind === "apple"

  return (
    <div className="p-2">
      <div
        ref={card}
        className="flex w-[340px] flex-col gap-3 rounded-lg bg-popover p-3 text-popover-foreground shadow-md ring-1 ring-foreground/10"
      >
        {state && (
          <>
            <div className="flex items-center gap-2">
              <h1 className="flex-1 text-sm font-medium">
                {update ? "更新已保存的密码？" : "保存这个登录？"}
              </h1>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="关闭"
                onClick={() =>
                  void callOverlay("prompt.close", {}).catch(() => {})
                }
              >
                <XIcon />
              </Button>
            </div>
            <div className="flex items-center gap-2.5">
              <SiteLetter text={state.host} />
              <div className="flex min-w-0 flex-1 flex-col gap-px">
                <span className="truncate text-sm font-medium">
                  {state.username}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {state.host}
                </span>
              </div>
            </div>
            {update ? (
              state.updateSource && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <BrandIcon kind={state.updateSource.kind} />
                  <span className="min-w-0">
                    将更新 {state.updateSource.label} 里的这个条目
                  </span>
                </p>
              )
            ) : (
              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  保存到
                </span>
                <SourceSelect
                  sources={state.targets}
                  value={target}
                  onChange={setTarget}
                  label="保存到"
                />
              </div>
            )}
            {busy && appleTarget && (
              <p className="text-xs text-muted-foreground">
                在 Mac 弹出的窗口中确认保存。
              </p>
            )}
            {message && <p className="text-xs text-destructive">{message}</p>}
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                disabled={busy}
                onClick={guarded(
                  () => void callOverlay("prompt.never", {}).catch(() => {}),
                )}
              >
                此站点不再询问
              </Button>
              <Button
                className="ml-auto"
                disabled={busy || (!update && !target)}
                onClick={() => void confirm()}
              >
                {update ? "更新" : "保存"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

import { CheckIcon, CopyIcon, EyeIcon, Trash2Icon } from "lucide-react"
import { useEffect, useState } from "react"
import { callBackground, type HistoryEntry } from "@/background/api"
import { errorMessage } from "@/components/keyward/errors"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { BackHeader } from "./header"

/** Fixed length, so the mask does not reveal how long a password is. */
const MASK = "••••••••••••"

const relative = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" })
const date = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" })

function whenText(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60_000)
  if (minutes < 1) return "刚刚"
  if (minutes < 60) return relative.format(-minutes, "minute")
  const hours = Math.round(minutes / 60)
  if (hours < 24) return relative.format(-hours, "hour")
  const days = Math.round(hours / 24)
  if (days < 2) return relative.format(-days, "day")
  return date.format(at)
}

export function HistoryView({ onBack }: { onBack: () => void }) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null)
  const [shown, setShown] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    void callBackground("history.list", null).then(setEntries)
  }, [])

  const copy = async (id: string) => {
    setMessage(null)
    try {
      await callBackground("history.copy", { id })
      setCopied(id)
      setTimeout(() => setCopied(null), 1500)
    } catch (error) {
      setMessage(errorMessage(error))
    }
  }

  const clear = async () => {
    await callBackground("history.clear", null)
    setEntries([])
    setConfirming(false)
  }

  return (
    <div className="flex max-h-[600px] min-h-[264px] flex-col">
      <BackHeader title="生成历史" onBack={onBack}>
        {confirming ? (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirming(false)}
            >
              取消
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive"
              onClick={() => void clear()}
            >
              清空全部
            </Button>
          </div>
        ) : (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="显示密码"
              title="显示密码"
              aria-pressed={shown}
              className="aria-pressed:bg-muted"
              onClick={() => setShown(!shown)}
            >
              <EyeIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="清空历史"
              title="清空历史"
              disabled={!entries?.length}
              onClick={() => setConfirming(true)}
            >
              <Trash2Icon />
            </Button>
          </div>
        )}
      </BackHeader>
      <Separator />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {message && (
          <p className="px-3 pt-2 text-xs text-destructive">{message}</p>
        )}
        {entries && !entries.length && (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            没有记录
          </p>
        )}
        <div className="flex flex-col gap-0.5 p-1">
          {entries?.map((entry) => (
            <div
              key={entry.id}
              className="group/row flex min-h-12 items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-muted focus-within:bg-muted"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-mono text-sm font-medium">
                  {shown ? entry.password : MASK}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {[entry.host, whenText(entry.at)].filter(Boolean).join(" · ")}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                className="opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 hover:bg-background"
                aria-label="复制密码"
                title="复制密码"
                onClick={() => void copy(entry.id)}
              >
                {copied === entry.id ? <CheckIcon /> : <CopyIcon />}
              </Button>
            </div>
          ))}
        </div>
      </div>
      <Separator />
      <p className="px-3 py-2 text-xs text-muted-foreground">
        记录复制过或用于添加密码的生成密码。只保存在本机，关闭浏览器后清除。
      </p>
    </div>
  )
}

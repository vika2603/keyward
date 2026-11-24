import { Dice3Icon } from "lucide-react"
import { useEffect, useState } from "react"
import { callBackground } from "@/background/api"
import { errorMessage } from "@/components/keyward/errors"
import { SourceSelect } from "@/components/keyward/source-select"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import type { SourceInfo } from "@/lib/backends/types"
import { generatePassword, generatorOptionsItem } from "@/lib/generator"
import { BackHeader } from "./header"

export function AddView({ onBack }: { onBack: () => void }) {
  const [site, setSite] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [targets, setTargets] = useState<SourceInfo[] | null>(null)
  const [target, setTarget] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    void callBackground("popup.state", null).then((state) => {
      if (state.page) setSite((current) => current || state.page?.host || "")
    })
    void callBackground("popup.saveTargets", null).then((result) => {
      setTargets(result.targets)
      setTarget(result.defaultTarget)
    })
  }, [])

  const generate = async () => {
    const generated = generatePassword(await generatorOptionsItem.getValue())
    setPassword(generated)
    await callBackground("generator.record", {
      password: generated,
      site,
    }).catch(() => {})
  }

  const save = async () => {
    if (!target) return
    setBusy(true)
    setMessage(null)
    try {
      await callBackground("popup.saveLogin", {
        sourceId: target,
        site,
        username,
        password,
      })
      onBack()
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const apple = targets?.find((t) => t.id === target)?.kind === "apple"
  return (
    <form
      className="flex min-h-[376px] flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <BackHeader title="添加密码" onBack={onBack} />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pt-1 pb-3">
        <label className="flex flex-col gap-2">
          <span className="text-sm leading-none font-medium">网站</span>
          <Input
            value={site}
            onChange={(event) => setSite(event.target.value)}
            required
          />
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-sm leading-none font-medium">用户名</span>
          <Input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="off"
          />
        </label>
        <div className="flex flex-col gap-2">
          <label
            htmlFor="add-password"
            className="text-sm leading-none font-medium"
          >
            密码
          </label>
          <div className="relative">
            <Input
              id="add-password"
              className="pr-9 font-mono"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              required
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute top-0.5 right-0.5"
              aria-label="生成密码"
              title="生成密码"
              onClick={() => void generate()}
            >
              <Dice3Icon />
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm leading-none font-medium">保存到</span>
          <SourceSelect
            sources={targets ?? []}
            value={target}
            onChange={setTarget}
            label="保存到"
          />
          {targets?.length === 0 && (
            <p className="text-xs text-muted-foreground">
              需要先在主界面连接 Apple 密码或解锁 Bitwarden 账户。
            </p>
          )}
        </div>
        {busy && apple && (
          <p className="text-xs text-muted-foreground">
            在 Mac 弹出的窗口中确认保存。
          </p>
        )}
        {message && <p className="text-xs text-destructive">{message}</p>}
      </div>
      <Separator />
      <div className="px-3 pt-2.5 pb-3">
        <Button
          type="submit"
          className="w-full"
          disabled={busy || !target || !site || !password}
        >
          保存
        </Button>
      </div>
    </form>
  )
}

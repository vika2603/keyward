import { useEffect, useState } from "react"
import { callBackground } from "@/background/api"
import { ApplePairing } from "@/components/keyward/apple-pairing"
import { BACKEND_NAMES, BrandIcon } from "@/components/keyward/brand-icon"
import { errorMessage } from "@/components/keyward/errors"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { SecondStepMethod } from "@/lib/backends/bitwarden/auth"
import type { PendingSignInView } from "@/lib/backends/bitwarden/bitwarden-backend"
import type { BackendKind } from "@/lib/backends/types"
import { navigate } from "./App"

const METHODS: Record<SecondStepMethod, { name: string; hint: string }> = {
  authenticator: {
    name: "验证器 App",
    hint: "输入验证器 App 里显示的验证码。",
  },
  email: { name: "邮件", hint: "验证码已发送到登录邮箱。" },
  recoveryCode: {
    name: "恢复代码",
    hint: "输入开启两步验证时保存的恢复代码。",
  },
  newDevice: {
    name: "新设备验证",
    hint: "服务器已向登录邮箱发送验证码，用来确认这台新设备。",
  },
}

/** First run, and adding accounts later: connect one backend at a time. */
export function OnboardPage() {
  const [kind, setKind] = useState<BackendKind>("bitwarden")
  const done = () => navigate("backends")

  return (
    <div className="flex min-h-screen flex-col items-center bg-muted px-4 pt-12 pb-16">
      <main className="flex w-full max-w-[440px] flex-col gap-4">
        <header className="flex flex-col gap-1.5 pb-2 text-center">
          <h1 className="text-2xl leading-8 font-semibold tracking-tight">
            连接密码后端
          </h1>
          <p className="text-sm text-muted-foreground">
            选择要使用的后端。其他后端和账号可以之后在设置里添加。
          </p>
        </header>
        <section className="flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <Tabs
            value={kind}
            onValueChange={(value) => setKind(value as BackendKind)}
          >
            <TabsList className="w-full" aria-label="选择要连接的后端">
              {(["apple", "bitwarden"] as const).map((k) => (
                <TabsTrigger key={k} value={k}>
                  <BrandIcon kind={k} />
                  {BACKEND_NAMES[k]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {kind === "apple" ? (
            <ApplePairing autoStart={false} onPaired={done} />
          ) : (
            <SignIn onSignedIn={done} />
          )}
        </section>
        <div className="flex justify-end">
          <Button variant="ghost" onClick={done}>
            稍后设置
          </Button>
        </div>
      </main>
    </div>
  )
}

function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [server, setServer] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [pending, setPending] = useState<PendingSignInView | null>(null)
  const [method, setMethod] = useState<SecondStepMethod | null>(null)
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const choose = (next: SecondStepMethod) => {
    setMethod(next)
    setMessage(null)
    if (next === "email") {
      callBackground("bitwarden.sendEmailCode", null).catch((error) =>
        setMessage(errorMessage(error)),
      )
    }
  }

  const showSecondStep = (view: PendingSignInView) => {
    setPending(view)
    setCode("")
    const first = view.methods[0]
    if (first) choose(first)
  }

  useEffect(() => {
    void callBackground("bitwarden.pendingSignIn", null).then((view) => {
      if (view) {
        setServer(view.server)
        setEmail(view.email)
        setPending(view)
        setMethod(view.methods[0] ?? null)
      }
    })
  }, [])

  const run = async (task: () => Promise<void>) => {
    setBusy(true)
    setMessage(null)
    try {
      await task()
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  if (pending && method) {
    return (
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          void run(async () => {
            await callBackground("bitwarden.submitSecondStep", { method, code })
            onSignedIn()
          })
        }}
      >
        <div className="flex flex-col gap-2">
          <span className="text-sm leading-none font-medium">验证方式</span>
          <Select
            value={method}
            onValueChange={(value) => choose(value as SecondStepMethod)}
            items={pending.methods.map((m) => ({
              value: m,
              label: METHODS[m].name,
            }))}
          >
            <SelectTrigger className="w-full" aria-label="验证方式">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pending.methods.map((m) => (
                <SelectItem key={m} value={m}>
                  {METHODS[m].name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="flex flex-col gap-2">
          <span className="text-sm leading-none font-medium">验证码</span>
          <Input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="one-time-code"
            spellCheck={false}
            autoFocus
          />
          <span className="text-xs text-muted-foreground">
            {METHODS[method].hint}
          </span>
        </label>
        {message && <p className="text-xs text-destructive">{message}</p>}
        <div className="flex flex-col gap-2">
          <Button
            type="submit"
            className="w-full"
            disabled={busy || !code.trim()}
          >
            验证并登录
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => {
              void callBackground("bitwarden.cancelSignIn", null)
              setPending(null)
              setMethod(null)
              setMessage(null)
            }}
          >
            返回
          </Button>
        </div>
      </form>
    )
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        void run(async () => {
          const outcome = await callBackground("bitwarden.signIn", {
            server,
            email,
            password,
          })
          setPassword("")
          if (outcome.kind === "signedIn") onSignedIn()
          else showSecondStep(outcome.pending)
        })
      }}
    >
      <label className="flex flex-col gap-2">
        <span className="text-sm leading-none font-medium">服务器地址</span>
        <Input
          inputMode="url"
          spellCheck={false}
          value={server}
          onChange={(event) => setServer(event.target.value)}
          placeholder="https://vault.example.com"
        />
        <span className="text-xs text-muted-foreground">
          留空则使用官方服务。
        </span>
      </label>
      <label className="flex flex-col gap-2">
        <span className="text-sm leading-none font-medium">邮箱</span>
        <Input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="username"
          required
        />
      </label>
      <label className="flex flex-col gap-2">
        <span className="text-sm leading-none font-medium">主密码</span>
        <Input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
        />
      </label>
      {message && <p className="text-xs text-destructive">{message}</p>}
      <Button
        type="submit"
        className="w-full"
        disabled={busy || !email || !password}
      >
        {busy ? "正在登录…" : "登录"}
      </Button>
    </form>
  )
}

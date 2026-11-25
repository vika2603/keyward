import { useEffect, useState } from "react"
import { callBackground } from "@/background/api"
import { BrandIcon } from "@/components/keyward/brand-icon"
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
import { t } from "@/lib/i18n"
import {
  lastServerItem,
  selfHostedServerItem,
} from "@/lib/providers/bitwarden/account-store"
import type { SecondStepMethod } from "@/lib/providers/bitwarden/auth"
import type { PendingSignInView } from "@/lib/providers/bitwarden/bitwarden-provider"
import { navigate } from "./App"

function methodTexts(): Record<
  SecondStepMethod,
  { name: string; hint: string }
> {
  return {
    authenticator: {
      name: t("options.onboard.method.authenticator"),
      hint: t("options.onboard.method.authenticatorHint"),
    },
    email: {
      name: t("options.onboard.method.email"),
      hint: t("options.onboard.method.emailHint"),
    },
    recoveryCode: {
      name: t("options.onboard.method.recoveryCode"),
      hint: t("options.onboard.method.recoveryCodeHint"),
    },
    newDevice: {
      name: t("options.onboard.method.newDevice"),
      hint: t("options.onboard.method.newDeviceHint"),
    },
  }
}

/** Signs in to a Bitwarden account; Passwords is paired from the popup when it is used. */
export function OnboardPage() {
  const done = () => navigate("vaults")

  return (
    <div className="flex min-h-screen flex-col items-center bg-muted px-4 pt-12 pb-16">
      <main className="flex w-full max-w-[440px] flex-col gap-4">
        <header className="flex flex-col items-center gap-1.5 pb-2 text-center">
          <div className="mb-2 flex size-12 items-center justify-center rounded-xl bg-card ring-1 ring-foreground/10">
            <BrandIcon kind="bitwarden" className="size-6" />
          </div>
          <h1 className="text-2xl leading-8 font-semibold tracking-tight">
            {t("options.onboard.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("options.onboard.description")}
          </p>
        </header>
        <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <SignIn onSignedIn={done} />
        </section>
        <div className="flex justify-end">
          <Button variant="ghost" onClick={done}>
            {t("options.onboard.later")}
          </Button>
        </div>
      </main>
    </div>
  )
}

function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [selfHosted, setSelfHosted] = useState(false)
  const [serverUrl, setServerUrl] = useState("")
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
    void Promise.all([
      callBackground("bitwarden.pendingSignIn", null),
      lastServerItem.getValue(),
      selfHostedServerItem.getValue(),
    ]).then(([view, lastServer, savedUrl]) => {
      const server = view ? view.server : lastServer
      setSelfHosted(server !== "")
      setServerUrl(server || savedUrl || lastServer)
      if (view) {
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
    const methods = methodTexts()
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
          <span className="text-sm leading-none font-medium">
            {t("options.onboard.secondStep.method")}
          </span>
          <Select
            value={method}
            onValueChange={(value) => choose(value as SecondStepMethod)}
            items={pending.methods.map((m) => ({
              value: m,
              label: methods[m].name,
            }))}
          >
            <SelectTrigger
              className="w-full"
              aria-label={t("options.onboard.secondStep.method")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pending.methods.map((m) => (
                <SelectItem key={m} value={m}>
                  {methods[m].name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="flex flex-col gap-2">
          <span className="text-sm leading-none font-medium">
            {t("options.onboard.secondStep.code")}
          </span>
          <Input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="one-time-code"
            spellCheck={false}
            autoFocus
          />
          <span className="text-xs text-muted-foreground">
            {methods[method].hint}
          </span>
        </label>
        {message && <p className="text-xs text-destructive">{message}</p>}
        <div className="flex flex-col gap-2">
          <Button
            type="submit"
            className="w-full"
            disabled={busy || !code.trim()}
          >
            {t("options.onboard.secondStep.submit")}
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
            {t("options.onboard.secondStep.back")}
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
          const server = selfHosted ? serverUrl.trim() : ""
          const outcome = await callBackground("bitwarden.signIn", {
            server,
            email,
            password,
          })
          setPassword("")
          await lastServerItem.setValue(server)
          if (server) await selfHostedServerItem.setValue(server)
          if (outcome.kind === "signedIn") onSignedIn()
          else showSecondStep(outcome.pending)
        })
      }}
    >
      <label className="flex flex-col gap-2">
        <span className="text-sm leading-none font-medium">
          {t("options.onboard.signIn.email")}
        </span>
        <Input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="username"
          required
        />
      </label>
      <label className="flex flex-col gap-2">
        <span className="text-sm leading-none font-medium">
          {t("options.onboard.signIn.masterPassword")}
        </span>
        <Input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
        />
      </label>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">
            {t("options.onboard.signIn.server")}
          </span>
          <Select
            value={selfHosted ? "selfHosted" : "official"}
            onValueChange={(value) => setSelfHosted(value === "selfHosted")}
            items={[
              {
                value: "official",
                label: t("options.onboard.signIn.official"),
              },
              {
                value: "selfHosted",
                label: t("options.onboard.signIn.selfHosted"),
              },
            ]}
          >
            <SelectTrigger
              size="sm"
              aria-label={t("options.onboard.signIn.server")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="official">
                {t("options.onboard.signIn.official")}
              </SelectItem>
              <SelectItem value="selfHosted">
                {t("options.onboard.signIn.selfHosted")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        {selfHosted && (
          <Input
            inputMode="url"
            spellCheck={false}
            value={serverUrl}
            onChange={(event) => setServerUrl(event.target.value)}
            placeholder="https://vault.example.com"
            aria-label={t("options.onboard.signIn.serverUrl")}
            required
          />
        )}
      </div>
      {message && <p className="text-xs text-destructive">{message}</p>}
      <Button
        type="submit"
        className="w-full"
        disabled={
          busy || !email || !password || (selfHosted && !serverUrl.trim())
        }
      >
        {busy
          ? t("options.onboard.signIn.busy")
          : t("options.onboard.signIn.submit")}
      </Button>
    </form>
  )
}

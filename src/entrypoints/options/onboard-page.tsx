import { ChevronLeftIcon } from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"
import { callBackground } from "@/background/api"
import { BrandIcon } from "@/components/keyward/brand-icon"
import { notifyError } from "@/components/keyward/notify"
import { SecretInput } from "@/components/keyward/secret-input"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { t } from "@/lib/i18n"
import type { SecondStepMethod } from "@/lib/providers/bitwarden/auth"
import type { PendingSignInView } from "@/lib/providers/bitwarden/bitwarden-provider"
import {
  isCloudServer,
  tryNormalizeServerAddress,
} from "@/lib/providers/bitwarden/server"
import { navigate } from "./navigation"
import { ChoiceSelect } from "./parts"
import {
  lastServerItem,
  selfHostedEndpointsItem,
  selfHostedServerItem,
} from "./remembered-server"
import {
  type SelfHostedServer,
  type ServerChoice,
  ServerPicker,
  serverAddressOf,
  serverChoiceOf,
} from "./server-picker"

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
    <div className="flex min-h-screen flex-col items-center bg-canvas px-4 pt-8 pb-16">
      <main className="flex w-full max-w-[420px] flex-col gap-4">
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 text-muted-foreground"
            onClick={done}
          >
            <ChevronLeftIcon />
            {t("options.onboard.backToSettings")}
          </Button>
        </div>
        <header className="flex flex-col items-center gap-1.5 pb-2 text-center">
          <div className="mb-2 flex size-12 items-center justify-center rounded-xl border border-border/80 bg-card shadow-2xs">
            <BrandIcon kind="bitwarden" className="size-6" />
          </div>
          <h1 className="text-2xl leading-8 font-semibold tracking-tight">
            {t("options.onboard.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("options.onboard.description")}
          </p>
        </header>
        <section className="rounded-xl border border-border/80 bg-card p-5 shadow-2xs">
          <SignIn onSignedIn={done} />
        </section>
      </main>
    </div>
  )
}

/** An address as saved by an earlier version, normalized; empty when it is not an address. */
function savedAddress(address: string): string {
  return tryNormalizeServerAddress(address) ?? ""
}

/** The sign-in form of a Bitwarden account with its second step; the welcome page shows it too. */
export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [serverChoice, setServerChoice] = useState<ServerChoice>("us")
  const [selfHosted, setSelfHosted] = useState<SelfHostedServer>({
    address: "",
    endpoints: {},
  })
  /** The self-hosted servers of the signed-in accounts, offered as choices. */
  const [knownServers, setKnownServers] = useState<SelfHostedServer[]>([])
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [pending, setPending] = useState<PendingSignInView | null>(null)
  const [method, setMethod] = useState<SecondStepMethod | null>(null)
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const passwordRef = useRef<HTMLInputElement>(null)
  const codeRef = useRef<HTMLInputElement>(null)
  const ids = useId()

  const choose = (next: SecondStepMethod) => {
    setMethod(next)
    if (next === "email") {
      callBackground("bitwarden.sendEmailCode", null).catch(notifyError)
    }
  }

  const showSecondStep = (view: PendingSignInView) => {
    setPending(view)
    setCode("")
    const first = view.methods[0]
    if (first) choose(first)
  }

  useEffect(() => {
    callBackground("bitwarden.accounts", null).then(
      (accounts) => {
        const servers = new Map<string, SelfHostedServer>()
        for (const account of accounts)
          if (!isCloudServer(account.server) && !servers.has(account.server))
            servers.set(account.server, {
              address: account.server,
              endpoints: account.endpoints ?? {},
            })
        setKnownServers([...servers.values()])
      },
      () => {
        // Without the accounts, only the last server set up is offered.
      },
    )
    Promise.all([
      callBackground("bitwarden.pendingSignIn", null),
      lastServerItem.getValue(),
      selfHostedServerItem.getValue(),
      selfHostedEndpointsItem.getValue(),
    ])
      .then(([view, lastServer, savedUrl, savedEndpoints]) => {
        const server = view ? view.server : savedAddress(lastServer)
        const choice = serverChoiceOf(server)
        setServerChoice(choice)
        setSelfHosted(
          choice === "selfHosted"
            ? {
                address: server,
                endpoints: view ? (view.endpoints ?? {}) : savedEndpoints,
              }
            : { address: savedAddress(savedUrl), endpoints: savedEndpoints },
        )
        if (view) {
          setEmail(view.email)
          setPending(view)
          setMethod(view.methods[0] ?? null)
        }
      })
      .catch(notifyError)
  }, [])

  const run = async (
    task: () => Promise<void>,
    onErrorField?: HTMLInputElement | null,
  ) => {
    setBusy(true)
    try {
      await task()
    } catch (error) {
      notifyError(error)
      onErrorField?.focus()
      onErrorField?.select()
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
          }, codeRef.current)
        }}
      >
        <Field>
          <Label htmlFor={`${ids}-method`}>
            {t("options.onboard.secondStep.method")}
          </Label>
          <ChoiceSelect
            id={`${ids}-method`}
            names={pending.methods.map((candidate) => [
              candidate,
              methods[candidate].name,
            ])}
            value={method}
            onChange={choose}
            label={t("options.onboard.secondStep.method")}
            className="w-full"
          />
        </Field>
        <Field>
          <Label htmlFor={`${ids}-code`}>
            {t("options.onboard.secondStep.code")}
          </Label>
          <Input
            id={`${ids}-code`}
            ref={codeRef}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="one-time-code"
            spellCheck={false}
            autoFocus
          />
          <span className="text-xs text-muted-foreground">
            {methods[method].hint}
          </span>
        </Field>
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
              callBackground("bitwarden.cancelSignIn", null).catch(notifyError)
              setPending(null)
              setMethod(null)
            }}
          >
            {t("options.onboard.secondStep.startOver")}
          </Button>
        </div>
      </form>
    )
  }

  const server = serverAddressOf(serverChoice, selfHosted)
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        void run(async () => {
          const outcome = await callBackground("bitwarden.signIn", {
            server,
            endpoints:
              serverChoice === "selfHosted" ? selfHosted.endpoints : undefined,
            email,
            password,
          })
          setPassword("")
          await lastServerItem.setValue(server)
          if (outcome.kind === "signedIn") onSignedIn()
          else showSecondStep(outcome.pending)
        }, passwordRef.current)
      }}
    >
      <Field>
        <Label htmlFor={`${ids}-email`}>
          {t("options.onboard.signIn.email")}
        </Label>
        <Input
          id={`${ids}-email`}
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="username"
          autoFocus={!email}
          required
        />
      </Field>
      <Field>
        <Label htmlFor={`${ids}-password`}>
          {t("options.onboard.signIn.masterPassword")}
        </Label>
        <SecretInput
          id={`${ids}-password`}
          ref={passwordRef}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          autoFocus={Boolean(email)}
          required
        />
      </Field>
      <Button
        type="submit"
        className="w-full"
        disabled={
          busy ||
          !email ||
          !password ||
          (serverChoice === "selfHosted" && !server)
        }
      >
        {busy
          ? t("options.onboard.signIn.busy")
          : t("options.onboard.signIn.submit")}
      </Button>
      <ServerPicker
        choice={serverChoice}
        selfHosted={selfHosted}
        known={knownServers}
        onChoose={setServerChoice}
        onSelfHosted={(next) => {
          setSelfHosted(next)
          setServerChoice("selfHosted")
          void selfHostedServerItem.setValue(next.address)
          void selfHostedEndpointsItem.setValue(next.endpoints)
        }}
      />
    </form>
  )
}

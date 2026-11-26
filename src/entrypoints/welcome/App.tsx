import { CheckIcon, PinIcon } from "lucide-react"
import { type ReactNode, useCallback, useEffect, useState } from "react"
import keywardIcon from "@/assets/icon.svg"
import { callBackground } from "@/background/api"
import { useAppearance } from "@/components/keyward/appearance"
import { BrandIcon, providerName } from "@/components/keyward/brand-icon"
import { useLanguage } from "@/components/keyward/language"
import {
  usePasswordsAvailability,
  usePasswordsSupported,
} from "@/components/keyward/passwords-setup"
import { Button } from "@/components/ui/button"
import { Toaster } from "@/components/ui/toast"
import { SignIn } from "@/entrypoints/options/onboard-page"
import { useSettings } from "@/hooks/use-settings"
import { openConnectPasswords } from "@/lib/connect-passwords"
import { t } from "@/lib/i18n"
import type { AccountSummary } from "@/lib/providers/bitwarden/bitwarden-provider"

export function App() {
  const language = useLanguage()
  useAppearance()
  useEffect(() => {
    if (language) document.title = t("welcome.title")
  }, [language])
  if (!language) return null
  return (
    <Toaster closeLabel={t("common.close")}>
      <Welcome />
    </Toaster>
  )
}

/**
 * The page a new install opens. It leads to connecting Passwords, signs in to Bitwarden, asks for
 * the toolbar pin that keeps the popup at hand, and opens the popup. Pairing Passwords waits for its
 * first use in the popup, as a pairing lasts only while the browser runs.
 */
function Welcome() {
  const [settings] = useSettings()
  const passwordsSupported = usePasswordsSupported()
  const [accounts, setAccounts] = useState<AccountSummary[] | null>(null)
  const loadAccounts = useCallback(() => {
    callBackground("bitwarden.accounts", null).then(setAccounts, () =>
      setAccounts([]),
    )
  }, [])
  useEffect(loadAccounts, [loadAccounts])

  if (!settings || !accounts || passwordsSupported === null) return null
  const connected = settings.appleEnabled || accounts.length > 0

  return (
    <div className="flex min-h-screen flex-col items-center bg-canvas px-4 pt-12 pb-16">
      <main className="flex w-full max-w-[540px] flex-col gap-3.5">
        <header className="flex flex-col items-center gap-1.5 pb-4 text-center">
          <img
            src={keywardIcon}
            alt=""
            draggable={false}
            className="mb-3 size-16"
          />
          <h1 className="text-2xl leading-8 font-semibold tracking-tight">
            {t("welcome.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {passwordsSupported
              ? t("welcome.description")
              : t("welcome.descriptionWithoutPasswords")}
          </p>
        </header>
        {passwordsSupported && (
          <PasswordsCard enabled={settings.appleEnabled} />
        )}
        <BitwardenCard accounts={accounts} onSignedIn={loadAccounts} />
        <PinCard />
        <footer className="flex flex-col items-center gap-3 pt-4 text-center">
          <Button
            size="lg"
            disabled={!connected}
            // An older background without the request leaves the toolbar icon to the user.
            onClick={() =>
              void callBackground("welcome.openPopup", null).catch(() => {})
            }
          >
            {t("welcome.open")}
          </Button>
          <p className="text-sm text-muted-foreground">
            {connected ? t("welcome.tip") : t("welcome.connectFirst")}
          </p>
        </footer>
      </main>
    </div>
  )
}

/**
 * Passwords, connected once it is on and the browser reaches the helper. Connecting takes the
 * Connect Passwords page in a tab of its own, so this page stays for the other steps.
 */
function PasswordsCard({ enabled }: { enabled: boolean }) {
  const availability = usePasswordsAvailability()
  const icon = <BrandIcon kind="apple" className="size-6" />

  if (enabled && availability === "ready") {
    return (
      <StepCard
        icon={icon}
        title={providerName("apple")}
        description={t("welcome.apple.connected")}
        side={<DoneMark label={t("welcome.connected")} />}
      />
    )
  }
  return (
    <StepCard
      icon={icon}
      title={providerName("apple")}
      description={t("welcome.apple.description")}
      side={
        // Until the check answers, Passwords may turn out to be connected already.
        availability && (
          <Button variant="outline" onClick={() => void openConnectPasswords()}>
            {t("welcome.connect")}
          </Button>
        )
      }
    />
  )
}

function BitwardenCard({
  accounts,
  onSignedIn,
}: {
  accounts: AccountSummary[]
  onSignedIn: () => void
}) {
  const [signingIn, setSigningIn] = useState(false)
  const signedIn = accounts.length > 0 && !signingIn

  let side: ReactNode
  if (signedIn) side = <DoneMark label={t("welcome.signedIn")} />
  else if (signingIn)
    side = (
      <Button variant="ghost" onClick={() => setSigningIn(false)}>
        {t("welcome.cancel")}
      </Button>
    )
  else
    side = (
      <Button variant="outline" onClick={() => setSigningIn(true)}>
        {t("welcome.signIn")}
      </Button>
    )

  return (
    <StepCard
      icon={<BrandIcon kind="bitwarden" className="size-6" />}
      title={providerName("bitwarden")}
      description={
        signedIn
          ? accounts.map((account) => account.label).join(" · ")
          : t("welcome.bitwarden.description")
      }
      side={side}
    >
      {signingIn && (
        <SignIn
          onSignedIn={() => {
            setSigningIn(false)
            onSignedIn()
          }}
        />
      )}
    </StepCard>
  )
}

/**
 * Whether Keyward's icon is on the toolbar, null when the browser does not say. Chrome reports a
 * change from version 130; before that, coming back to the page reads it again.
 */
function useToolbarPin(): boolean | null {
  const [pinned, setPinned] = useState<boolean | null>(null)
  useEffect(() => {
    const read = () =>
      browser.action.getUserSettings().then(
        ({ isOnToolbar }) => setPinned(isOnToolbar),
        () => {},
      )
    const changed = ({ isOnToolbar }: { isOnToolbar?: boolean }) => {
      if (isOnToolbar !== undefined) setPinned(isOnToolbar)
    }
    void read()
    browser.action.onUserSettingsChanged?.addListener(changed)
    window.addEventListener("focus", read)
    return () => {
      browser.action.onUserSettingsChanged?.removeListener(changed)
      window.removeEventListener("focus", read)
    }
  }, [])
  return pinned
}

/**
 * Asks for the toolbar pin once the icon is seen off the toolbar, and shows the pin done after
 * that. A new install can be on the toolbar already, and then there is nothing to ask.
 */
function PinCard() {
  const pinned = useToolbarPin()
  const [asked, setAsked] = useState(false)
  useEffect(() => {
    if (pinned === false) setAsked(true)
  }, [pinned])
  if (!asked || pinned === null) return null
  return (
    <StepCard
      icon={<PinIcon className="size-5" />}
      title={t("welcome.pin.title")}
      description={
        pinned ? t("welcome.pin.done") : t("welcome.pin.description")
      }
      side={pinned && <DoneMark label={t("welcome.pin.pinned")} />}
    />
  )
}

/** One thing to connect or set, with its state or action beside the title and its steps below. */
function StepCard({
  icon,
  title,
  description,
  side,
  children,
}: {
  icon: ReactNode
  title: string
  description: string
  side?: ReactNode
  children?: ReactNode
}) {
  return (
    <section className="flex flex-col gap-4 overflow-hidden rounded-xl border border-border/80 bg-card p-4 shadow-2xs">
      <div className="flex items-center gap-3.5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          {icon}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="text-sm font-medium">{title}</h2>
          <p className="text-[0.8125rem] leading-5 text-muted-foreground">
            {description}
          </p>
        </div>
        {side}
      </div>
      {children && (
        <div className="flex flex-col gap-3 border-t pt-4">{children}</div>
      )}
    </section>
  )
}

function DoneMark({ label }: { label: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-sm font-medium text-success">
      <span className="flex size-5 animate-connected-pop items-center justify-center rounded-full bg-success text-success-foreground motion-reduce:animate-none">
        <CheckIcon className="size-3" strokeWidth={3} />
      </span>
      {label}
    </span>
  )
}

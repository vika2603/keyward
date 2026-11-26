import { CheckIcon } from "lucide-react"
import { useEffect, useState } from "react"
import keywardIcon from "@/assets/icon.svg"
import { useAppearance } from "@/components/keyward/appearance"
import { BrandIcon } from "@/components/keyward/brand-icon"
import { useLanguage } from "@/components/keyward/language"
import { FADE_IN } from "@/components/keyward/loading"
import {
  RemovalDetails,
  SetUpStep,
  type SetupStatus,
  useSetupStatus,
} from "@/components/keyward/passwords-setup"
import { pageBrowser } from "@/components/keyward/setup-commands"
import { t } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/** How the header shows the link between Keyward and Passwords. */
type Link = "connecting" | "stopped" | "connected"

function linkOf(status: SetupStatus): Link {
  if (status === "done") return "connected"
  if (status === "helperStopped" || status === "failed" || status === "notMac")
    return "stopped"
  return "connecting"
}

/** The start of each dot's animation, so they light up one after another. */
const DOT_DELAYS = ["0ms", "200ms", "400ms"]

export function App() {
  const language = useLanguage()
  useAppearance()
  useEffect(() => {
    if (language) document.title = t("options.passwordsSetup.title")
  }, [language])
  return language ? <ConnectPasswords /> : null
}

/**
 * Lets the browser reach Passwords: a Terminal command lets it start the helper that comes with
 * macOS. Pairing waits until Passwords is first used, in the popup or a login field's menu. The
 * page has a tab of its own, since the popup closes as soon as Terminal takes the focus.
 */
function ConnectPasswords() {
  const { status, message, check } = useSetupStatus()
  const [targetBrowser, setTargetBrowser] = useState(pageBrowser)
  const setUp = status === "done"

  const link = linkOf(status)

  return (
    <div className="flex min-h-screen flex-col items-center bg-muted px-4 pt-16 pb-16">
      <main className="flex w-full max-w-[520px] flex-col gap-8">
        <header className="flex flex-col items-center gap-1 text-center">
          <ConnectionIcons link={link} />
          <h1 className="mt-5 text-2xl leading-8 font-semibold tracking-tight">
            {t("options.passwordsSetup.title")}
          </h1>
          <LinkStatus link={link} />
        </header>
        <section className="flex flex-col gap-4 rounded-xl bg-card p-5 ring-1 ring-foreground/10">
          {setUp ? (
            <>
              <p className="text-sm text-muted-foreground">
                {t("options.passwordsSetup.connected")}
              </p>
              <RemovalDetails />
            </>
          ) : (
            <SetUpStep
              status={status}
              message={message}
              targetBrowser={targetBrowser}
              onBrowserChange={setTargetBrowser}
              onCheckAgain={() => void check()}
            />
          )}
        </section>
      </main>
    </div>
  )
}

/** Keyward and Passwords side by side; the dots between them move while the two connect. */
function ConnectionIcons({ link }: { link: Link }) {
  return (
    <div className="flex items-center gap-3" aria-hidden="true">
      <img src={keywardIcon} alt="" draggable={false} className="size-14" />
      <div className="flex w-16 items-center justify-center gap-2">
        {link === "connected" ? (
          // The check pops in and sends out a ring, as a chime would sound.
          <span className="relative flex size-6 items-center justify-center">
            <span className="absolute inset-0 animate-connected-ring rounded-full bg-success motion-reduce:hidden" />
            <span className="relative flex size-6 animate-connected-pop items-center justify-center rounded-full bg-success text-success-foreground motion-reduce:animate-none">
              <CheckIcon className="size-3.5" strokeWidth={3} />
            </span>
          </span>
        ) : (
          DOT_DELAYS.map((delay) => (
            <span
              key={delay}
              style={{ animationDelay: delay }}
              className={cn(
                "size-2 rounded-full bg-muted-foreground",
                link === "connecting"
                  ? "animate-connecting-dot motion-reduce:animate-none"
                  : "opacity-40",
              )}
            />
          ))
        )}
      </div>
      <BrandIcon kind="apple" className="size-14" />
    </div>
  )
}

const LINK_STATUS_KEYS = {
  connecting: "options.passwordsSetup.link.connecting",
  stopped: "options.passwordsSetup.link.stopped",
  connected: "options.passwordsSetup.link.connected",
} as const

/** Says in words what the icons above show; it is announced as it changes. */
function LinkStatus({ link }: { link: Link }) {
  return (
    <p
      key={link}
      role="status"
      className={cn(
        "text-lg leading-7 font-medium",
        link === "connected" ? "text-success" : "text-muted-foreground",
        FADE_IN,
      )}
    >
      {t(LINK_STATUS_KEYS[link])}
    </p>
  )
}

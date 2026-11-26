import {
  CheckIcon,
  ChevronRightIcon,
  LoaderCircleIcon,
  RotateCwIcon,
  SquareTerminalIcon,
} from "lucide-react"
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react"
import keywardIcon from "@/assets/icon.svg"
import { callBackground } from "@/background/api"
import { useAppearance } from "@/components/keyward/appearance"
import { BrandIcon } from "@/components/keyward/brand-icon"
import { errorMessage } from "@/components/keyward/errors"
import { FormError } from "@/components/keyward/form-field"
import { useLanguage } from "@/components/keyward/language"
import { FADE_IN } from "@/components/keyward/loading"
import {
  BrowserSelect,
  CommandBox,
  pageBrowser,
} from "@/components/keyward/setup-commands"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { t } from "@/lib/i18n"
import type { HelperCheck } from "@/lib/providers/apple/helper-port"
import {
  SETUP_SCRIPT_PAGE,
  type SetupBrowser,
  setupCommand,
} from "@/lib/providers/apple/setup-command"
import { cn } from "@/lib/utils"

/** How often the page looks again while it waits for the command to run. */
const CHECK_INTERVAL_MS = 2000

/** Where the one-time setup of this Mac stands. */
type SetupStatus =
  | "checking"
  /** The command has not run yet. */
  | "waiting"
  /** The command ran for another copy of Keyward, with another extension ID. */
  | "otherExtension"
  | "helperStopped"
  /** The helper cannot be reached for a reason the browser does not tell. */
  | "failed"
  | "notMac"
  | "done"

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

function statusOf(check: HelperCheck): SetupStatus {
  if (check.reached) return "done"
  switch (check.problem) {
    case "notSetUp":
      return "waiting"
    case "otherExtension":
      return "otherExtension"
    case "helperStopped":
      return "helperStopped"
    default:
      return "failed"
  }
}

/**
 * Checks whether the browser reaches the Passwords helper, and keeps checking while the page is
 * shown and waits for the command, so the page moves on by itself once it has run.
 */
function useSetupStatus() {
  const [status, setStatus] = useState<SetupStatus>("checking")
  const [message, setMessage] = useState<string | null>(null)
  const checking = useRef(false)

  const check = useCallback(async () => {
    if (checking.current) return
    checking.current = true
    try {
      setStatus(statusOf(await callBackground("apple.checkSetup", null)))
      setMessage(null)
    } catch (error) {
      setStatus("failed")
      setMessage(errorMessage(error))
    } finally {
      checking.current = false
    }
  }, [])

  useEffect(() => {
    void browser.runtime.getPlatformInfo().then(
      ({ os }) => (os === "mac" ? check() : setStatus("notMac")),
      () => check(),
    )
  }, [check])

  useEffect(() => {
    if (status !== "waiting" && status !== "otherExtension") return
    const checkWhileShown = () => {
      if (document.visibilityState === "visible") void check()
    }
    const timer = setInterval(checkWhileShown, CHECK_INTERVAL_MS)
    // Coming back from Terminal is when the command has most likely run.
    window.addEventListener("focus", checkWhileShown)
    document.addEventListener("visibilitychange", checkWhileShown)
    return () => {
      clearInterval(timer)
      window.removeEventListener("focus", checkWhileShown)
      document.removeEventListener("visibilitychange", checkWhileShown)
    }
  }, [status, check])

  return { status, message, check }
}

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

  return (
    <div className="flex min-h-screen flex-col items-center bg-muted px-4 pt-12 pb-16">
      <main className="flex w-full max-w-[560px] flex-col gap-4">
        <header className="flex flex-col items-center gap-1.5 text-center">
          <h1 className="text-2xl leading-8 font-semibold tracking-tight">
            {t("options.passwordsSetup.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("options.passwordsSetup.description")}
          </p>
          <div className="flex flex-col items-center gap-3 pt-8 pb-6">
            <ConnectionIcons link={linkOf(status)} />
            <LinkStatus link={linkOf(status)} />
          </div>
        </header>
        <SetupCard done={setUp}>
          {setUp ? (
            <>
              <p className="text-sm text-muted-foreground">
                {t("options.passwordsSetup.connected")}
              </p>
              <Button
                variant="outline"
                className="w-fit"
                onClick={() => void browser.runtime.openOptionsPage()}
              >
                {t("options.passwordsSetup.openSettings")}
              </Button>
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
        </SetupCard>
      </main>
    </div>
  )
}

/** Keyward and Passwords side by side; the dots between them move while the two connect. */
function ConnectionIcons({ link }: { link: Link }) {
  return (
    <div className="flex items-center gap-3" aria-hidden="true">
      <img src={keywardIcon} alt="" draggable={false} className="size-12" />
      <div className="flex w-14 items-center justify-center gap-2">
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
      <BrandIcon kind="apple" className="size-12" />
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

/** The card of the setup, whose icon turns into a check once the browser reaches Passwords. */
function SetupCard({ done, children }: { done: boolean; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <h2 className="flex items-center gap-3 text-sm font-medium">
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full",
            done ? "bg-success/15 text-success" : "bg-muted",
          )}
        >
          {done ? (
            <CheckIcon
              className="size-3.5 animate-connected-pop motion-reduce:animate-none"
              strokeWidth={3}
            />
          ) : (
            <SquareTerminalIcon className="size-3.5" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          {t("options.passwordsSetup.setUp.title")}
        </span>
        {done && (
          <span className="text-xs font-normal text-muted-foreground">
            {t("options.passwordsSetup.done")}
          </span>
        )}
      </h2>
      <div className="flex flex-col gap-3 pl-9">{children}</div>
    </section>
  )
}

function SetUpStep({
  status,
  message,
  targetBrowser,
  onBrowserChange,
  onCheckAgain,
}: {
  status: SetupStatus
  message: string | null
  /** The browser the command sets up. */
  targetBrowser: SetupBrowser
  onBrowserChange: (browser: SetupBrowser) => void
  onCheckAgain: () => void
}) {
  if (status === "notMac") {
    return (
      <p className="text-sm text-muted-foreground">
        {t("options.passwordsSetup.notMac")}
      </p>
    )
  }
  if (status === "checking") {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" />
        {t("options.passwordsSetup.checking")}
      </p>
    )
  }
  const stopped = status === "helperStopped" || status === "failed"
  return (
    <>
      <p className="text-sm text-muted-foreground">
        {t("options.passwordsSetup.setUp.description")}
      </p>
      <BrowserSelect value={targetBrowser} onChange={onBrowserChange} />
      <CommandBox command={setupCommand(browser.runtime.id, targetBrowser)} />
      <p className="text-sm text-muted-foreground">
        {t("options.passwordsSetup.terminal")}
      </p>
      {status === "otherExtension" && (
        <FormError>{t("options.passwordsSetup.otherExtension")}</FormError>
      )}
      {stopped ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <FormError className="min-w-0 flex-1">
            {status === "helperStopped"
              ? t("options.passwordsSetup.helperStopped")
              : (message ?? t("error.apple.unavailable"))}
          </FormError>
          <Button variant="outline" size="sm" onClick={onCheckAgain}>
            <RotateCwIcon />
            {t("options.passwordsSetup.checkAgain")}
          </Button>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircleIcon
            className="size-4 shrink-0 animate-spin"
            aria-hidden="true"
          />
          {t("options.passwordsSetup.waiting")}
        </p>
      )}
      <CommandDetails />
    </>
  )
}

function CommandDetails() {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1 rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
        <ChevronRightIcon
          className={cn("size-4 transition-transform", open && "rotate-90")}
        />
        {t("options.passwordsSetup.details")}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-2 pt-2 text-sm text-muted-foreground">
          <p>{t("options.passwordsSetup.detailsText")}</p>
          <a
            href={SETUP_SCRIPT_PAGE}
            target="_blank"
            rel="noreferrer"
            className="w-fit text-foreground underline-offset-4 hover:underline"
          >
            {t("options.passwordsSetup.viewScript")}
          </a>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

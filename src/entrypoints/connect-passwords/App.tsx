import {
  CheckIcon,
  ChevronRightIcon,
  CopyIcon,
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
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  COPIED_FEEDBACK_MS,
  useTransientValue,
} from "@/hooks/use-transient-value"
import { t } from "@/lib/i18n"
import type {
  ApplePhase,
  AppleState,
} from "@/lib/providers/apple/helper-session"
import {
  removalCommand,
  SETUP_SCRIPT_PAGE,
  setupCommand,
} from "@/lib/providers/apple/setup-command"
import { cn } from "@/lib/utils"

/** How often the page looks again while it waits for the command to run. */
const CHECK_INTERVAL_MS = 2000

/** The phases in which the browser reaches the helper, so pairing can start when Passwords is used. */
const REACHED_PHASES: ReadonlySet<ApplePhase> = new Set([
  "unpaired",
  "awaitingCode",
  "paired",
])

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

function statusOf(state: AppleState): SetupStatus {
  if (REACHED_PHASES.has(state.phase)) return "done"
  if (state.phase !== "unavailable") return "checking"
  switch (state.problem) {
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
  const setUp = status === "done"

  return (
    <div className="flex min-h-screen flex-col items-center bg-muted px-4 pt-12 pb-16">
      <main className="flex w-full max-w-[560px] flex-col gap-4">
        <header className="flex flex-col items-center gap-1.5 pb-2 text-center">
          <ConnectionIcons link={linkOf(status)} />
          <h1 className="text-2xl leading-8 font-semibold tracking-tight">
            {t("options.passwordsSetup.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("options.passwordsSetup.description")}
          </p>
        </header>
        <SetupCard done={setUp}>
          {setUp ? (
            <p className="text-sm text-muted-foreground">
              {t("options.passwordsSetup.pairLater")}
            </p>
          ) : (
            <SetUpStep
              status={status}
              message={message}
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
    <div className="mb-3 flex items-center gap-3" aria-hidden="true">
      <img src={keywardIcon} alt="" draggable={false} className="size-12" />
      <div className="flex w-14 items-center justify-center gap-2">
        {link === "connected" ? (
          <span className="flex size-5 items-center justify-center rounded-full bg-foreground text-background">
            <CheckIcon className="size-3" strokeWidth={3} />
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

/** The card of the setup, whose icon turns into a check once the browser reaches Passwords. */
function SetupCard({ done, children }: { done: boolean; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <h2 className="flex items-center gap-3 text-sm font-medium">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted">
          {done ? (
            <CheckIcon className="size-3.5" />
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
  onCheckAgain,
}: {
  status: SetupStatus
  message: string | null
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
      <CommandBox command={setupCommand(browser.runtime.id)} />
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

/** A command to paste into Terminal, with a button that copies it. */
function CommandBox({ command }: { command: string }) {
  const [copied, showCopied] = useTransientValue<true>(COPIED_FEEDBACK_MS)
  const label = copied
    ? t("options.passwordsSetup.copied")
    : t("options.passwordsSetup.copy")
  const copy = () =>
    navigator.clipboard.writeText(command).then(
      () => showCopied(true),
      // The command can still be selected and copied by hand.
      () => {},
    )

  return (
    <div className="flex items-start gap-2 rounded-lg bg-muted py-1.5 pr-1.5 pl-3">
      <code className="min-w-0 flex-1 py-1 font-mono text-xs leading-5 break-all select-all">
        {command}
      </code>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        title={label}
        onClick={() => void copy()}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </div>
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
          <p>{t("options.passwordsSetup.removal")}</p>
          <CommandBox command={removalCommand()} />
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

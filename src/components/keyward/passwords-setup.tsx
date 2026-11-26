import { ChevronRightIcon, LoaderCircleIcon, RotateCwIcon } from "lucide-react"
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react"
import { callBackground } from "@/background/api"
import { errorMessage } from "@/components/keyward/errors"
import { FormError } from "@/components/keyward/form-field"
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
import {
  type HelperCheck,
  isSetupProblem,
} from "@/lib/providers/apple/helper-port"
import {
  removalCommand,
  SETUP_SCRIPT_PAGE,
  type SetupBrowser,
  setupCommand,
} from "@/lib/providers/apple/setup-command"
import { getSettings, updateSettings } from "@/lib/settings"
import { cn } from "@/lib/utils"

/** How often a page looks again while it waits for the command to run. */
const CHECK_INTERVAL_MS = 2000

/** Where the one-time setup of this Mac stands. */
export type SetupStatus =
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

async function isMac(): Promise<boolean> {
  try {
    return (await browser.runtime.getPlatformInfo()).os === "mac"
  } catch {
    // Without an answer, the check of the helper tells instead.
    return true
  }
}

/**
 * Checks whether the browser reaches the Passwords helper, and keeps checking while the page is
 * shown and waits for the command, so the page moves on by itself once it has run. A page uses
 * this once the user asks to connect Passwords, so reaching the helper turns Passwords on.
 */
export function useSetupStatus() {
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
    void isMac().then((mac) => (mac ? check() : setStatus("notMac")))
  }, [check])

  useEffect(() => {
    const waiting = status === "waiting" || status === "otherExtension"
    if (!waiting && status !== "done") return
    const checkWhileShown = () => {
      if (document.visibilityState === "visible") void check()
    }
    const timer = waiting
      ? setInterval(checkWhileShown, CHECK_INTERVAL_MS)
      : undefined
    // Coming back from Terminal is when a command has most likely run: the setup, or once it is
    // done, its removal.
    window.addEventListener("focus", checkWhileShown)
    document.addEventListener("visibilitychange", checkWhileShown)
    return () => {
      clearInterval(timer)
      window.removeEventListener("focus", checkWhileShown)
      document.removeEventListener("visibilitychange", checkWhileShown)
    }
  }, [status, check])

  useEffect(() => {
    if (status !== "done") return
    void (async () => {
      if (!(await getSettings()).appleEnabled)
        await updateSettings({ appleEnabled: true })
    })()
      // The settings keep their switch for the user to turn on.
      .catch(() => {})
  }, [status])

  return { status, message, check }
}

/**
 * Whether this computer has Passwords at all, null until the browser says. Only macOS comes with
 * the helper; elsewhere the interface leaves Passwords out.
 */
export function usePasswordsSupported(): boolean | null {
  const [supported, setSupported] = useState<boolean | null>(null)
  useEffect(() => {
    void isMac().then(setSupported)
  }, [])
  return supported
}

/** Whether Passwords can be connected on this computer: not at all, after its setup, or now. */
export type PasswordsAvailability = "unsupported" | "needsSetup" | "ready"

/**
 * Where Passwords stands on this computer, null until the check answers. It checks again when the
 * page comes back to the front, as the setup is done or removed in another tab and in Terminal.
 */
export function usePasswordsAvailability(): PasswordsAvailability | null {
  const [availability, setAvailability] =
    useState<PasswordsAvailability | null>(null)
  useEffect(() => {
    const check = async () => {
      if (!(await isMac())) return setAvailability("unsupported")
      try {
        const answer = await callBackground("apple.checkSetup", null)
        setAvailability(
          !answer.reached && isSetupProblem(answer.problem)
            ? "needsSetup"
            : "ready",
        )
      } catch {
        // Pairing finds out about the setup by itself.
        setAvailability("ready")
      }
    }
    const checkWhenShown = () => {
      if (document.visibilityState === "visible") void check()
    }
    void check()
    document.addEventListener("visibilitychange", checkWhenShown)
    return () =>
      document.removeEventListener("visibilitychange", checkWhenShown)
  }, [])
  return availability
}

/**
 * The Terminal command that sets up this Mac for the chosen browser, and where checking it stands.
 * It shows nothing once the setup is done; the page says that in its own way.
 */
export function SetUpStep({
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
  if (status === "done") return null
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
      {stopped && (
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
      )}
      <CommandDetails />
    </>
  )
}

/** A folded section under a setup step, opened by a line of text. */
function Details({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1 rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
        <ChevronRightIcon
          className={cn("size-4 transition-transform", open && "rotate-90")}
        />
        {title}
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  )
}

/** The command that takes the setup away again, folded until asked for. */
export function RemovalDetails() {
  const [targetBrowser, setTargetBrowser] = useState(pageBrowser)
  return (
    <Details title={t("options.vaults.apple.removal.title")}>
      <div className="flex flex-col gap-3 pt-2">
        <p className="text-sm text-muted-foreground">
          {t("options.vaults.apple.removal.description")}
        </p>
        <BrowserSelect value={targetBrowser} onChange={setTargetBrowser} />
        <CommandBox command={removalCommand(targetBrowser)} />
      </div>
    </Details>
  )
}

function CommandDetails() {
  return (
    <Details title={t("options.passwordsSetup.details")}>
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
    </Details>
  )
}

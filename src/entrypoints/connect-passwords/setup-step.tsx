import { LoaderCircleIcon, RotateCwIcon } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { callBackground } from "@/background/api"
import { errorMessage } from "@/components/keyward/errors"
import { FormError } from "@/components/keyward/form-field"
import { Details, runsOnMac } from "@/components/keyward/passwords-setup"
import { BrowserSelect, CommandBox } from "@/components/keyward/setup-commands"
import { Button } from "@/components/ui/button"
import { t } from "@/lib/i18n"
import type { HelperCheck } from "@/lib/providers/apple/helper-port"
import {
  SETUP_SCRIPT_PAGE,
  type SetupBrowser,
  setupCommand,
} from "@/lib/providers/apple/setup-command"
import { getSettings, updateSettings } from "@/lib/settings"

/** How often the page looks again while it waits for the command to run. */
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

/**
 * Checks whether the browser reaches the Passwords helper, and keeps checking while the page is
 * shown and waits for the command, so the page moves on by itself once it has run. The page opens
 * when the user asks to connect Passwords, so reaching the helper turns Passwords on.
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
    void runsOnMac().then((mac) => (mac ? check() : setStatus("notMac")))
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
 * The Terminal command that sets up this Mac for the chosen browser, and where checking it stands.
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

import { ChevronRightIcon } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { callBackground } from "@/background/api"
import {
  BrowserSelect,
  CommandBox,
  pageBrowser,
} from "@/components/keyward/setup-commands"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { t } from "@/lib/i18n"
import { isSetupProblem } from "@/lib/providers/apple/helper-port"
import { removalCommand } from "@/lib/providers/apple/setup-command"
import { cn } from "@/lib/utils"

/** Whether the browser runs on macOS, the only system that comes with the Passwords helper. */
export async function runsOnMac(): Promise<boolean> {
  try {
    return (await browser.runtime.getPlatformInfo()).os === "mac"
  } catch {
    // Without an answer, the check of the helper tells instead.
    return true
  }
}

/**
 * Whether this computer has Passwords at all, null until the browser says. Only macOS comes with
 * the helper; elsewhere the interface leaves Passwords out.
 */
export function usePasswordsSupported(): boolean | null {
  const [supported, setSupported] = useState<boolean | null>(null)
  useEffect(() => {
    void runsOnMac().then(setSupported)
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
      if (!(await runsOnMac())) return setAvailability("unsupported")
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

/** A folded section under a setup step, opened by a line of text. */
export function Details({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
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

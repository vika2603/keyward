import { CheckIcon, CopyIcon } from "lucide-react"
import { useId } from "react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  COPIED_FEEDBACK_MS,
  useTransientValue,
} from "@/hooks/use-transient-value"
import { t } from "@/lib/i18n"
import {
  likelyBrowser,
  SETUP_BROWSER_NAMES,
  SETUP_BROWSERS,
  type SetupBrowser,
} from "@/lib/providers/apple/setup-command"

/** The browser this page runs in, as far as the brands it reports tell. */
export function pageBrowser(): SetupBrowser {
  const { userAgentData } = navigator as Navigator & {
    userAgentData?: { brands: { brand: string }[] }
  }
  return likelyBrowser(userAgentData?.brands.map(({ brand }) => brand) ?? [])
}

/** Picks the browser a setup command is for. */
export function BrowserSelect({
  value,
  onChange,
}: {
  value: SetupBrowser
  onChange: (browser: SetupBrowser) => void
}) {
  const id = useId()
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className="text-sm text-foreground">
        {t("options.passwordsSetup.browser")}
      </label>
      <Select
        value={value}
        onValueChange={(next) => {
          const found = SETUP_BROWSERS.find((candidate) => candidate === next)
          if (found) onChange(found)
        }}
        items={SETUP_BROWSERS.map((candidate) => ({
          value: candidate,
          label: SETUP_BROWSER_NAMES[candidate],
        }))}
      >
        <SelectTrigger id={id} className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {SETUP_BROWSERS.map((candidate) => (
              <SelectItem key={candidate} value={candidate}>
                {SETUP_BROWSER_NAMES[candidate]}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}

/** A command to paste into Terminal, with a button that copies it. */
export function CommandBox({ command }: { command: string }) {
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
    <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/70 py-1.5 pr-1.5 pl-3">
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

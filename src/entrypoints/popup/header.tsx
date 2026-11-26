import {
  ChevronLeftIcon,
  SlidersHorizontalIcon,
  SquareArrowOutUpRightIcon,
} from "lucide-react"
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { openConnectPasswords } from "@/lib/connect-passwords"
import { t } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { usePopOut } from "./pop-out"

export function BackHeader({
  title,
  bordered = true,
  onBack,
  children,
}: {
  /** Left out on a page whose content names it already. */
  title?: string
  bordered?: boolean
  onBack: () => void
  children?: ReactNode
}) {
  const popOut = usePopOut()
  return (
    <div
      className={cn(
        "flex h-11 shrink-0 items-center gap-1.5 bg-background px-2",
        bordered && "border-b border-border/70",
      )}
    >
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-muted-foreground hover:text-foreground"
        aria-label={t("popup.back")}
        onClick={onBack}
      >
        <ChevronLeftIcon />
      </Button>
      {title ? (
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">
          {title}
        </h1>
      ) : (
        <div className="flex-1" />
      )}
      {children}
      {popOut && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
          aria-label={t("popup.popOut")}
          title={t("popup.popOut")}
          onClick={popOut}
        >
          <SquareArrowOutUpRightIcon />
        </Button>
      )}
    </div>
  )
}

export function SettingsButton() {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="text-muted-foreground hover:text-foreground"
      aria-label={t("popup.settings")}
      title={t("popup.settings")}
      onClick={() => {
        void browser.runtime.openOptionsPage()
        window.close()
      }}
    >
      <SlidersHorizontalIcon />
    </Button>
  )
}

/** Opens the page that connects Passwords; the popup would close anyway once Terminal takes the focus. */
export function openConnectPage(): void {
  void openConnectPasswords()
  window.close()
}

export function openOptions(hash: string): void {
  void browser.tabs.create({
    url: browser.runtime.getURL(`/options.html#${hash}`),
  })
  window.close()
}

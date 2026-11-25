import { ChevronLeftIcon, SlidersHorizontalIcon } from "lucide-react"
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { t } from "@/lib/i18n"

export function BackHeader({
  title,
  onBack,
  children,
}: {
  /** Left out on a page whose content names it already. */
  title?: string
  onBack: () => void
  children?: ReactNode
}) {
  return (
    <div className="flex items-center gap-2 p-2">
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("popup.back")}
        onClick={onBack}
      >
        <ChevronLeftIcon />
      </Button>
      {title && <h1 className="flex-1 text-sm font-medium">{title}</h1>}
      {children}
    </div>
  )
}

export function SettingsButton() {
  return (
    <Button
      variant="ghost"
      size="icon"
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

export function openOptions(hash: string): void {
  void browser.tabs.create({
    url: browser.runtime.getURL(`/options.html#${hash}`),
  })
  window.close()
}

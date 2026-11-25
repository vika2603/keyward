import { ChevronDownIcon } from "lucide-react"
import type { ComponentProps } from "react"
import { t } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/**
 * The chevron at the end of a group's heading. The group's name is the keyboard's way to fold it;
 * this is a second target for the pointer, so it stays out of the tab order. Not a ghost Button:
 * that one keeps a grey fill while it is expanded.
 */
export function FoldToggle({
  open,
  className,
  ...props
}: ComponentProps<"button"> & { open: boolean }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={t("popup.main.toggleGroup")}
      title={t("popup.main.toggleGroup")}
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground [&_svg]:size-3",
        className,
      )}
      {...props}
    >
      <ChevronDownIcon
        className={cn("transition-transform", !open && "-rotate-90")}
      />
    </button>
  )
}

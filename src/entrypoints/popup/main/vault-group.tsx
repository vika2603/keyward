import { ExternalLinkIcon, LockIcon } from "lucide-react"
import { type RefObject, useMemo } from "react"
import { callBackground, type VaultView } from "@/background/api"
import { BrandIcon, vaultLabel } from "@/components/keyward/brand-icon"
import { notifyError } from "@/components/keyward/notify"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { t } from "@/lib/i18n"
import type { LoginSummary, NoteSummary } from "@/lib/providers/types"
import type { Settings } from "@/lib/settings"
import { rowsOfVault, VirtualRows } from "./all-items"
import { FoldToggle } from "./fold-toggle"

/** One vault's logins for the site or the search, under the vault's name and buttons. */
export function VaultGroup({
  vault,
  heading,
  title,
  density,
  scrollElement,
  open,
  onOpenChange,
  onLocked,
  onOpen,
  onOpenNote,
}: {
  vault: VaultView
  /**
   * "vault" names the vault over its rows and folds them. "tab" is for a tab that names the vault
   * already, as the Passwords tab does: it says what the rows are instead, and keeps the buttons.
   */
  heading: "vault" | "tab"
  /** For the "tab" heading, what the rows are, such as the site's logins; none for search results. */
  title?: string
  density: Settings["density"]
  /** The list area, which scrolls the group's rows. */
  scrollElement: RefObject<HTMLDivElement | null>
  open: boolean
  onOpenChange: (open: boolean) => void
  onLocked: () => void
  onOpen: (login: LoginSummary) => void
  onOpenNote: (note: NoteSummary) => void
}) {
  const rows = useMemo(() => rowsOfVault(vault), [vault])

  const lock = async () => {
    try {
      await callBackground("popup.lock", { vaultId: vault.id })
    } catch (error) {
      notifyError(error)
    }
    onLocked()
  }

  if (vault.status !== "ready" || vault.error) {
    return (
      <section>
        <h2 className="flex items-center gap-1.5 px-3 pt-1.5 pb-0.5 text-xs font-medium text-muted-foreground">
          <BrandIcon kind={vault.kind} className="size-3.5" />
          <span className="min-w-0 flex-1 truncate">{vaultLabel(vault)}</span>
          <span className="py-1.5" title={vault.error}>
            {vault.status === "ready"
              ? t("vault.failed")
              : t("vault.unavailable")}
          </span>
        </h2>
      </section>
    )
  }

  const rowList = (
    <VirtualRows
      rows={rows}
      density={density}
      scrollElement={scrollElement}
      onOpenLogin={(_, login) => onOpen(login)}
      onOpenNote={(_, note) => onOpenNote(note)}
    />
  )
  const lockLabel =
    vault.kind === "apple" ? t("popup.main.lockApple") : t("popup.main.lock")
  const actions = (
    <>
      {vault.kind === "apple" && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground"
          aria-label={t("popup.main.openPasswordsApp")}
          title={t("popup.main.openPasswordsApp")}
          onClick={() =>
            void callBackground("apple.openPasswordsApp", {}).catch(notifyError)
          }
        >
          <ExternalLinkIcon />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground"
        aria-label={lockLabel}
        title={lockLabel}
        onClick={() => void lock()}
      >
        <LockIcon />
      </Button>
    </>
  )

  // Laid out as the list header of a tab that lists whole vaults. With nothing to fold, the rows show
  // whatever was folded before.
  if (heading === "tab") {
    return (
      <section>
        <div className="flex min-h-9 items-center gap-0.5 px-3 pt-2 pb-1.5">
          {title && (
            <h2 className="min-w-0 truncate text-xs font-semibold">{title}</h2>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-0.5">
            {actions}
          </span>
          <span className="shrink-0 pl-1.5 text-xs text-muted-foreground tabular-nums">
            {rows.length}
          </span>
        </div>
        {rowList}
      </section>
    )
  }

  return (
    <Collapsible open={open} onOpenChange={onOpenChange} render={<section />}>
      {/* The chevron stays last and the lock, which every group has, next to it, so both line up
          across groups; the Apple group's extra button sits further left. */}
      <h2 className="flex min-h-8 items-center gap-0.5 pt-1.5 pr-2">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch px-3 text-left text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
          <BrandIcon kind={vault.kind} className="size-3.5" />
          <span className="min-w-0 truncate">{vaultLabel(vault)}</span>
        </CollapsibleTrigger>
        {actions}
        <CollapsibleTrigger render={<FoldToggle open={open} />} />
      </h2>
      <CollapsibleContent>
        <div className="pt-0.5">{rowList}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

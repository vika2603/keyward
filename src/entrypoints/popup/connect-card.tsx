import { ChevronRightIcon } from "lucide-react"
import { BrandIcon } from "@/components/keyward/brand-icon"
import { connectTexts } from "@/components/keyward/connect-texts"
import type { ProviderKind, VaultInfo } from "@/lib/providers/types"

/** A large button leading to pairing, unlocking or signing in. */
export function ConnectCard({
  kind,
  title,
  detail,
  onClick,
}: {
  kind: ProviderKind
  title: string
  detail?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group/card flex w-full items-center gap-3 rounded-xl bg-card px-3.5 py-3 text-left ring-1 ring-foreground/10 outline-none transition-colors hover:bg-muted focus-visible:ring-foreground/35"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted group-hover/card:bg-background">
        <BrandIcon kind={kind} className="size-5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        {detail && (
          <span className="truncate text-xs text-muted-foreground">
            {detail}
          </span>
        )}
      </span>
      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
    </button>
  )
}

/** The card that pairs or sets up Passwords, or unlocks a locked Bitwarden account. */
export function LockedVaultCard({
  vault,
  onClick,
}: {
  vault: VaultInfo
  onClick: () => void
}) {
  const { title, detail } = connectTexts(vault)
  return (
    <ConnectCard
      kind={vault.kind}
      title={title}
      detail={detail}
      onClick={onClick}
    />
  )
}

import { ApplePairing } from "@/components/keyward/apple-pairing"
import { BitwardenUnlock } from "@/components/keyward/bitwarden-unlock"
import {
  accountIdOfVault,
  isBitwardenVault,
} from "@/lib/providers/bitwarden/vault-id"
import type { ProviderKind } from "@/lib/providers/types"
import { BackHeader, openConnectPage, openOptions } from "./header"

/** Pairs Apple Passwords or unlocks one account, each on a page of its own. */
export function ConnectView({
  kind,
  vaultId,
  onDone,
}: {
  kind: ProviderKind
  vaultId?: string
  onDone: () => void
}) {
  const accountId =
    vaultId && isBitwardenVault(vaultId) ? accountIdOfVault(vaultId) : undefined

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BackHeader bordered={false} onBack={onDone} />
      <div className="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto px-5 pb-12">
        {kind === "apple" ? (
          <ApplePairing onPaired={onDone} onSetUp={openConnectPage} />
        ) : (
          <BitwardenUnlock
            initialAccountId={accountId}
            onUnlocked={onDone}
            onSignIn={() => openOptions("onboard")}
          />
        )}
      </div>
    </div>
  )
}

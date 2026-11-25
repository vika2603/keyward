import { ApplePairing } from "@/components/keyward/apple-pairing"
import { BitwardenUnlock } from "@/components/keyward/bitwarden-unlock"
import {
  accountIdOfSource,
  isBitwardenSource,
} from "@/lib/backends/bitwarden/source-id"
import type { BackendKind } from "@/lib/backends/types"
import { BackHeader, openOptions } from "./header"

/** Pairs Apple Passwords or unlocks one account, each on a page of its own. */
export function ConnectView({
  kind,
  sourceId,
  onDone,
}: {
  kind: BackendKind
  sourceId?: string
  onDone: () => void
}) {
  const accountId =
    sourceId && isBitwardenSource(sourceId)
      ? accountIdOfSource(sourceId)
      : undefined

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BackHeader onBack={onDone} />
      <div className="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto px-4 pb-12">
        {kind === "apple" ? (
          <ApplePairing autoStart onPaired={onDone} />
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

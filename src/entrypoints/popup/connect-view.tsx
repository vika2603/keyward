import { useState } from "react"
import { ApplePairing } from "@/components/keyward/apple-pairing"
import { BitwardenUnlock } from "@/components/keyward/bitwarden-unlock"
import { BACKEND_NAMES, BrandIcon } from "@/components/keyward/brand-icon"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  accountIdOfSource,
  isBitwardenSource,
} from "@/lib/backends/bitwarden/source-id"
import type { BackendKind } from "@/lib/backends/types"
import { openOptions, SettingsButton } from "./header"

/** Pairs Apple Passwords or unlocks an account; one backend at a time, chosen by the user. */
export function ConnectView({
  kind,
  sourceId,
  onDone,
}: {
  kind: BackendKind
  sourceId?: string
  onDone: () => void
}) {
  const [selected, setSelected] = useState<BackendKind>(kind)
  const accountId =
    sourceId && isBitwardenSource(sourceId)
      ? accountIdOfSource(sourceId)
      : undefined

  return (
    <div className="flex min-h-[228px] flex-col">
      <div className="flex items-center gap-1 p-2">
        <Tabs
          className="mr-1 min-w-0 flex-1"
          value={selected}
          onValueChange={(value) => setSelected(value as BackendKind)}
        >
          <TabsList className="w-full" aria-label="选择要连接的后端">
            {(["apple", "bitwarden"] as const).map((k) => (
              <TabsTrigger key={k} value={k}>
                <BrandIcon kind={k} />
                {BACKEND_NAMES[k]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <SettingsButton />
      </div>
      <div className="min-h-0 flex-1 px-3 pt-1 pb-3">
        {selected === "apple" ? (
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

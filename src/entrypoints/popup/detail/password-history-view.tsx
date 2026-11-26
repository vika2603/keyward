import { useMemo, useState } from "react"
import { formatDate } from "@/components/keyward/format"
import { FADE_IN } from "@/components/keyward/loading"
import { notifyError } from "@/components/keyward/notify"
import { useBackgroundQuery } from "@/hooks/use-background-query"
import { t } from "@/lib/i18n"
import type { LoginSummary, VaultInfo } from "@/lib/providers/types"
import { BackHeader } from "../header"
import {
  CopyButton,
  copyText,
  DetailRow,
  MaskText,
  RevealButton,
  SecretText,
  Section,
  toggled,
} from "./detail-parts"

/** A login's earlier passwords, newest first, each hidden until the user shows it. */
export function PasswordHistoryView({
  vault,
  login,
  onBack,
}: {
  vault: VaultInfo
  login: LoginSummary
  onBack: () => void
}) {
  const ids = useMemo(
    () => ({ vaultId: vault.id, loginId: login.id }),
    [vault.id, login.id],
  )
  const { data: entries } = useBackgroundQuery("popup.passwordHistory", ids, {
    onError: notifyError,
  })
  const [shownEntries, setShownEntries] = useState<ReadonlySet<number>>(
    () => new Set(),
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BackHeader title={t("popup.passwordHistory.title")} onBack={onBack} />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-canvas p-3">
        {entries?.length === 0 && (
          <p className="px-1 text-sm text-muted-foreground">
            {t("popup.passwordHistory.empty")}
          </p>
        )}
        {entries && entries.length > 0 && (
          <div className={FADE_IN}>
            <Section>
              {entries.map((entry, index) => {
                const shown = shownEntries.has(index)
                return (
                  <DetailRow
                    // biome-ignore lint/suspicious/noArrayIndexKey: passwords may repeat; their position is their identity.
                    key={index}
                    actions={
                      <>
                        <RevealButton
                          shown={shown}
                          showLabel={t("popup.detail.showPassword")}
                          hideLabel={t("popup.detail.hidePassword")}
                          onClick={() =>
                            setShownEntries((current) =>
                              toggled(current, index),
                            )
                          }
                        />
                        <CopyButton
                          label={t("popup.copyPassword")}
                          copy={() => copyText(entry.password, true)}
                        />
                      </>
                    }
                  >
                    <div className="flex flex-col gap-0.5">
                      {shown ? (
                        <SecretText value={entry.password} />
                      ) : (
                        <MaskText />
                      )}
                      {entry.replaced !== undefined && (
                        <span className="text-xs text-muted-foreground">
                          {t("popup.passwordHistory.replaced", {
                            date: formatDate(entry.replaced),
                          })}
                        </span>
                      )}
                    </div>
                  </DetailRow>
                )
              })}
            </Section>
          </div>
        )}
      </div>
    </div>
  )
}

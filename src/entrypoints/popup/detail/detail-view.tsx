import { ChevronRightIcon, ExternalLinkIcon } from "lucide-react"
import { useMemo, useState } from "react"
import { callBackground } from "@/background/api"
import { FADE_IN } from "@/components/keyward/loading"
import { notifyError } from "@/components/keyward/notify"
import { SiteIcon } from "@/components/keyward/site-icon"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useBackgroundQuery } from "@/hooks/use-background-query"
import { t } from "@/lib/i18n"
import type { LoginSummary, VaultInfo } from "@/lib/providers/types"
import { cn } from "@/lib/utils"
import {
  CopyButton,
  copyText,
  DeleteButton,
  DetailRow,
  formatDate,
  IconButton,
  InfoRow,
  RepromptForm,
  requestOrNotify,
  Section,
} from "./detail-parts"
import {
  CustomFieldsSection,
  ItemDetailHeader,
  ItemInfoSection,
  ItemTitle,
} from "./item-detail"
import { OneTimeCodeField } from "./one-time-code-field"
import { PasswordField } from "./password-field"

/** An address that can be opened in a tab: one with a web scheme, or a bare host. */
function webUrl(uri: string): string | null {
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(uri) ? uri : `https://${uri}`
  try {
    const url = new URL(candidate)
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : null
  } catch {
    return null
  }
}

/** The credentials card's shape, shown until the login's details arrive. */
function DetailSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-1.5">
      <span className="sr-only">{t("common.loading")}</span>
      <Skeleton className="mx-1 h-3 w-16" />
      <div className="rounded-xl bg-card ring-1 ring-foreground/10">
        {["w-40", "w-28"].map((width) => (
          <div
            key={width}
            className="flex min-h-12 flex-col justify-center gap-1.5 border-t px-3 py-2 first:border-t-0"
          >
            <Skeleton className="h-3 w-12" />
            <Skeleton className={cn("h-3.5", width)} />
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * One login of the page: its username, password, one-time code, addresses, notes, custom fields and
 * history. The password and code are read only when asked for; Apple asks for Touch ID first.
 */
export function DetailView({
  vault,
  login,
  onBack,
  onEdit,
  onPasswordHistory,
}: {
  vault: VaultInfo
  login: LoginSummary
  /** Also where the view goes once the login was deleted. */
  onBack: () => void
  onEdit: () => void
  onPasswordHistory: () => void
}) {
  const ids = useMemo(
    () => ({ vaultId: vault.id, loginId: login.id }),
    [vault.id, login.id],
  )
  const apple = vault.kind === "apple"
  const {
    data: details,
    error: loadError,
    reload,
    update: updateDetails,
  } = useBackgroundQuery("popup.details", ids, { onError: notifyError })
  /** The password waits for Touch ID or the provider; the next code waits for it. */
  const [passwordPending, setPasswordPending] = useState(false)

  /** True once the login is gone; false when the request failed and its error shows. */
  const remove = async () =>
    (await requestOrNotify(async () => {
      await callBackground("popup.removeLogin", ids)
      onBack()
      return true
    })) === true

  const name = details?.name || login.title
  const pastPasswordCount = details?.pastPasswordCount ?? 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ItemDetailHeader
        title={t("popup.detail.title")}
        vaultId={vault.id}
        itemId={login.id}
        details={details}
        onFavoriteChange={(favorite) =>
          updateDetails((current) => ({ ...current, favorite }))
        }
        onBack={onBack}
        onEdit={onEdit}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-3">
        <ItemTitle
          icon={<SiteIcon host={login.host} text={name} className="size-10" />}
          name={name}
        />
        {!details && !loadError && <DetailSkeleton />}
        {details && (
          <div className={cn("flex flex-col gap-3", FADE_IN)}>
            <Section title={t("popup.detail.credentials")}>
              <DetailRow
                label={t("popup.detail.username")}
                actions={
                  details.username && (
                    <CopyButton
                      label={t("popup.copyUsername")}
                      copy={() => copyText(details.username, false)}
                    />
                  )
                }
              >
                {details.username || (
                  <span className="text-muted-foreground">
                    {t("common.noUsername")}
                  </span>
                )}
              </DetailRow>
              {details.secretsWithheld ? (
                <div className="border-t first:border-t-0">
                  <RepromptForm
                    vaultId={vault.id}
                    itemId={login.id}
                    hint={t("popup.detail.withheld")}
                    onPassed={reload}
                  />
                </div>
              ) : (
                <>
                  <PasswordField
                    ids={ids}
                    apple={apple}
                    onPendingChange={setPasswordPending}
                  />
                  {details.hasCode && (
                    <OneTimeCodeField
                      ids={ids}
                      apple={apple}
                      refreshPaused={passwordPending}
                    />
                  )}
                </>
              )}
            </Section>
            {details.uris.length > 0 && (
              <Section title={t("popup.detail.websites")}>
                {details.uris.map((uri, index) => {
                  const url = webUrl(uri)
                  return (
                    <DetailRow
                      // biome-ignore lint/suspicious/noArrayIndexKey: addresses may repeat; their position is their identity.
                      key={index}
                      actions={
                        <>
                          {url && (
                            <IconButton
                              label={t("popup.detail.openWebsite")}
                              onClick={() => {
                                void browser.tabs.create({ url })
                                window.close()
                              }}
                            >
                              <ExternalLinkIcon />
                            </IconButton>
                          )}
                          <CopyButton
                            label={t("popup.detail.copyWebsite")}
                            copy={() => copyText(uri, false)}
                          />
                        </>
                      }
                    >
                      {uri}
                    </DetailRow>
                  )
                })}
              </Section>
            )}
            {details.notes && (
              <Section title={t("popup.detail.notes")}>
                <DetailRow
                  actions={
                    <CopyButton
                      label={t("popup.detail.copyNotes")}
                      copy={() => copyText(details.notes ?? "", true)}
                    />
                  }
                >
                  <span className="break-words whitespace-pre-wrap">
                    {details.notes}
                  </span>
                </DetailRow>
              </Section>
            )}
            <CustomFieldsSection fields={details.customFields ?? []} />
            <ItemInfoSection
              vault={vault}
              modified={details.modified}
              created={details.created}
              leading={
                details.hasPasskey && (
                  <InfoRow label={t("popup.detail.passkey")}>
                    {t("popup.detail.passkeySaved")}
                  </InfoRow>
                )
              }
            >
              {details.passwordModified !== undefined && (
                <InfoRow label={t("popup.detail.passwordModified")}>
                  {formatDate(details.passwordModified)}
                </InfoRow>
              )}
              {pastPasswordCount > 0 && (
                <button
                  type="button"
                  onClick={onPasswordHistory}
                  className="flex min-h-10 w-full items-center gap-3 border-t px-3 py-2 text-left text-sm outline-none first:border-t-0 last:rounded-b-xl hover:bg-muted focus-visible:bg-muted"
                >
                  <span className="flex-1">
                    {t("popup.detail.passwordHistory")}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {pastPasswordCount}
                  </span>
                  <ChevronRightIcon className="size-4 text-muted-foreground" />
                </button>
              )}
            </ItemInfoSection>
            {apple && (
              <Button
                variant="outline"
                onClick={() =>
                  void requestOrNotify(() =>
                    callBackground("apple.openPasswordsApp", {
                      site: login.host,
                    }),
                  )
                }
              >
                <ExternalLinkIcon />
                {t("popup.detail.openInPasswordsApp")}
              </Button>
            )}
            {details.editable && (
              <DeleteButton
                hint={t("popup.detail.deleteHint")}
                onDelete={remove}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

import { useMemo } from "react"
import { callBackground } from "@/background/api"
import { errorCodeOf } from "@/components/keyward/errors"
import { formatDate } from "@/components/keyward/format"
import { FADE_IN } from "@/components/keyward/loading"
import { NoteIcon } from "@/components/keyward/note-icon"
import { notifyError } from "@/components/keyward/notify"
import { Skeleton } from "@/components/ui/skeleton"
import { useBackgroundQuery } from "@/hooks/use-background-query"
import { t } from "@/lib/i18n"
import type { NoteSummary, VaultInfo } from "@/lib/providers/types"
import { cn } from "@/lib/utils"
import type { ArchiveInfo, TrashInfo } from "../views"
import {
  CopyButton,
  copyText,
  DetailRow,
  InfoRow,
  RepromptForm,
  requestOrNotify,
  Section,
} from "./detail-parts"
import {
  CustomFieldsSection,
  cloneVaultItem,
  ItemDetailHeader,
  ItemInfoSection,
  ItemLifecycleActions,
  ItemTitle,
  TrashedFallbackSection,
} from "./item-detail"

/** One secure note: its text, custom fields and dates. */
export function NoteView({
  vault,
  note,
  trashed,
  archived,
  onBack,
  onEdit,
}: {
  vault: VaultInfo
  note: NoteSummary
  trashed?: TrashInfo
  archived?: ArchiveInfo
  /** Also where the view goes once the note was deleted or restored. */
  onBack: () => void
  onEdit: () => void
}) {
  const ids = useMemo(
    () => ({ vaultId: vault.id, noteId: note.id }),
    [vault.id, note.id],
  )
  const {
    data: details,
    error: loadError,
    reload,
    update: updateDetails,
  } = useBackgroundQuery("popup.note", ids, {
    onError: (error) => {
      if (!(trashed || archived) || errorCodeOf(error) !== "notFound")
        notifyError(error)
    },
  })

  /** True once the note is gone; false when the request failed and its error shows. */
  const remove = async () =>
    (await requestOrNotify(async () => {
      await callBackground("popup.removeNote", ids)
      onBack()
      return true
    })) === true

  const name = details?.name || note.name
  const text = details?.text ?? ""
  const clone = () => cloneVaultItem(vault.id, note.id, name, onBack)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ItemDetailHeader
        title={t("popup.note.title")}
        vaultId={vault.id}
        itemId={note.id}
        details={details}
        onFavoriteChange={(favorite) =>
          updateDetails((current) => ({ ...current, favorite }))
        }
        onBack={onBack}
        onEdit={onEdit}
        onClone={!trashed && !archived ? clone : undefined}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-canvas p-3">
        <ItemTitle
          icon={<NoteIcon className="size-10 rounded-lg" />}
          name={name}
        />
        {!details && !loadError && (
          <div role="status" className="flex flex-col gap-1.5">
            <span className="sr-only">{t("common.loading")}</span>
            <Skeleton className="mx-1 h-3 w-16" />
            <Skeleton className="h-20 w-full rounded-xl" />
          </div>
        )}
        {details && (
          <div className={cn("flex flex-col gap-3", FADE_IN)}>
            {details.withheld && (
              <Section>
                <RepromptForm
                  vaultId={vault.id}
                  itemId={note.id}
                  hint={t("popup.note.withheld")}
                  onPassed={reload}
                />
              </Section>
            )}
            {text && (
              <Section title={t("popup.note.content")}>
                <DetailRow
                  actions={
                    <CopyButton
                      label={t("popup.note.copy")}
                      copy={() => copyText(text, true)}
                    />
                  }
                >
                  <span className="break-words whitespace-pre-wrap">
                    {text}
                  </span>
                </DetailRow>
              </Section>
            )}
            <CustomFieldsSection fields={details.customFields ?? []} />
            <ItemInfoSection
              vault={vault}
              modified={details.modified}
              created={details.created}
            >
              {trashed?.deletedAt !== undefined && (
                <InfoRow label={t("popup.detail.deleted")}>
                  {formatDate(trashed.deletedAt)}
                </InfoRow>
              )}
              {archived?.archivedAt !== undefined && (
                <InfoRow label={t("popup.detail.archived")}>
                  {formatDate(archived.archivedAt)}
                </InfoRow>
              )}
            </ItemInfoSection>
            <ItemLifecycleActions
              vaultId={vault.id}
              itemId={note.id}
              name={name}
              editable={details.editable}
              trashed={trashed}
              archived={archived}
              deleteHint={t("popup.note.deleteHint")}
              onDelete={remove}
              onDone={onBack}
            />
          </div>
        )}
        {!details && Boolean(loadError) && trashed && (
          <TrashedFallbackSection
            vault={vault}
            itemId={note.id}
            name={name}
            trashed={trashed}
            onDone={onBack}
          />
        )}
      </div>
    </div>
  )
}

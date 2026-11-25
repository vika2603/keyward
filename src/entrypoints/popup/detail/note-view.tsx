import { useMemo } from "react"
import { callBackground } from "@/background/api"
import { FADE_IN } from "@/components/keyward/loading"
import { NoteIcon } from "@/components/keyward/note-icon"
import { notifyError } from "@/components/keyward/notify"
import { Skeleton } from "@/components/ui/skeleton"
import { useBackgroundQuery } from "@/hooks/use-background-query"
import { t } from "@/lib/i18n"
import type { NoteSummary, VaultInfo } from "@/lib/providers/types"
import { cn } from "@/lib/utils"
import {
  CopyButton,
  copyText,
  DeleteButton,
  DetailRow,
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

/** One secure note: its text, custom fields and dates. */
export function NoteView({
  vault,
  note,
  onBack,
  onEdit,
}: {
  vault: VaultInfo
  note: NoteSummary
  /** Also where the view goes once the note was deleted. */
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
  } = useBackgroundQuery("popup.note", ids, { onError: notifyError })

  /** True once the note is gone; false when the request failed and its error shows. */
  const remove = async () =>
    (await requestOrNotify(async () => {
      await callBackground("popup.removeNote", ids)
      onBack()
      return true
    })) === true

  const name = details?.name || note.name
  const text = details?.text ?? ""

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
      />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-3">
        <ItemTitle icon={<NoteIcon className="size-10" />} name={name} />
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
            />
            {details.editable && (
              <DeleteButton
                hint={t("popup.note.deleteHint")}
                onDelete={remove}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

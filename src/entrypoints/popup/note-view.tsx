import { PencilIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { callBackground } from "@/background/api"
import { BrandIcon, vaultLabel } from "@/components/keyward/brand-icon"
import { errorMessage } from "@/components/keyward/errors"
import { FADE_IN } from "@/components/keyward/loading"
import { NoteIcon } from "@/components/keyward/note-icon"
import { Skeleton } from "@/components/ui/skeleton"
import { t } from "@/lib/i18n"
import type { NoteDetails, NoteSummary, VaultInfo } from "@/lib/providers/types"
import { cn } from "@/lib/utils"
import {
  CopyButton,
  CustomFieldRow,
  DeleteButton,
  Field,
  formatDate,
  IconButton,
  InfoRow,
  Section,
  toggled,
} from "./detail-parts"
import { BackHeader } from "./header"

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
  const [details, setDetails] = useState<NoteDetails | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  /** Indexes of the hidden custom fields the user revealed. */
  const [shownFields, setShownFields] = useState<ReadonlySet<number>>(
    () => new Set(),
  )

  useEffect(() => {
    callBackground("popup.note", ids).then(setDetails, (error) =>
      setMessage(errorMessage(error)),
    )
  }, [ids])

  const copyText = useCallback(async (text: string, secret: boolean) => {
    setMessage(null)
    try {
      await callBackground("popup.copyText", { text, secret })
      return true
    } catch (error) {
      setMessage(errorMessage(error))
      return false
    }
  }, [])

  const remove = async () => {
    setMessage(null)
    try {
      await callBackground("popup.removeNote", ids)
      onBack()
      return true
    } catch (error) {
      setMessage(errorMessage(error))
      return false
    }
  }

  const name = details?.name || note.name
  const text = details?.text ?? ""
  const customFields = details?.customFields ?? []

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BackHeader title={t("popup.note.title")} onBack={onBack}>
        {details?.editable && (
          <IconButton label={t("popup.detail.edit")} onClick={onEdit}>
            <PencilIcon />
          </IconButton>
        )}
      </BackHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-3">
        <div className="flex items-center gap-3 px-1">
          <NoteIcon className="size-10" />
          <span className="min-w-0 truncate text-base font-medium">{name}</span>
        </div>
        {message && <p className="px-1 text-xs text-destructive">{message}</p>}
        {!details && !message && (
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
                <p className="px-3 py-3 text-xs text-muted-foreground">
                  {t("popup.note.withheld")}
                </p>
              </Section>
            )}
            {text && (
              <Section title={t("popup.note.content")}>
                <Field
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
                </Field>
              </Section>
            )}
            {customFields.length > 0 && (
              <Section title={t("popup.detail.customFields")}>
                {customFields.map((field, index) => (
                  <CustomFieldRow
                    // biome-ignore lint/suspicious/noArrayIndexKey: field names may repeat; their position is their identity.
                    key={index}
                    field={field}
                    shown={shownFields.has(index)}
                    onToggle={() =>
                      setShownFields((shown) => toggled(shown, index))
                    }
                    copyText={copyText}
                  />
                ))}
              </Section>
            )}
            <Section title={t("popup.detail.info")}>
              <InfoRow label={t("popup.detail.vault")}>
                <BrandIcon kind={vault.kind} className="size-3.5 shrink-0" />
                <span className="truncate">{vaultLabel(vault)}</span>
              </InfoRow>
              {details.modified !== undefined && (
                <InfoRow label={t("popup.detail.modified")}>
                  {formatDate(details.modified)}
                </InfoRow>
              )}
              {details.created !== undefined && (
                <InfoRow label={t("popup.detail.created")}>
                  {formatDate(details.created)}
                </InfoRow>
              )}
            </Section>
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

import { useEffect, useState } from "react"
import { callBackground } from "@/background/api"
import { errorMessage } from "@/components/keyward/errors"
import { FormError, FormField } from "@/components/keyward/form-field"
import { FADE_IN } from "@/components/keyward/loading"
import { VaultSelect } from "@/components/keyward/vault-select"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { useAsyncAction } from "@/hooks/use-async-action"
import { t } from "@/lib/i18n"
import type {
  EditableNote,
  NoteSummary,
  VaultInfo,
} from "@/lib/providers/types"
import { cn } from "@/lib/utils"
import { CustomFieldsEditor } from "./custom-fields-editor"
import { loadNoteDraft, saveNoteDraft } from "./view-cache"

const EMPTY_NOTE: EditableNote = { name: "", text: "", customFields: [] }

/** What the form works on: an existing note, or a new one saved to one of `targets`. */
type NoteFormTarget =
  | { mode: "edit"; vault: VaultInfo; note: NoteSummary }
  | { mode: "create"; targets: VaultInfo[] }

/** A secure note's name, text and custom fields, with the button that saves them. */
export function NoteForm({
  target,
  onDone,
  onCancel,
}: {
  target: NoteFormTarget
  onDone: () => void
  /** Shown as a second button when given. */
  onCancel?: () => void
}) {
  const editing = target.mode === "edit" ? target : null
  const [form, setForm] = useState<EditableNote | null>(
    editing ? null : EMPTY_NOTE,
  )
  const [vaultId, setVaultId] = useState<string | null>(
    target.mode === "create" ? (target.targets[0]?.id ?? null) : null,
  )
  const { busy, message, setMessage, run } = useAsyncAction()

  const editedVaultId = editing?.vault.id
  const editedNoteId = editing?.note.id
  const draftKey =
    editedVaultId && editedNoteId ? `${editedVaultId}:${editedNoteId}` : "new"
  useEffect(() => {
    let active = true
    if (!editedVaultId || !editedNoteId) {
      void loadNoteDraft(draftKey).then((draft) => {
        if (active && draft) setForm(draft)
      })
      return () => {
        active = false
      }
    }
    Promise.all([
      callBackground("popup.editableNote", {
        vaultId: editedVaultId,
        noteId: editedNoteId,
      }),
      loadNoteDraft(draftKey),
    ]).then(
      ([loaded, draft]) => active && setForm(draft ?? loaded),
      (error) => active && setMessage(errorMessage(error)),
    )
    return () => {
      active = false
    }
  }, [editedVaultId, editedNoteId, draftKey, setMessage])

  const update = (change: Partial<EditableNote>) =>
    setForm((current) => {
      if (!current) return current
      const next = { ...current, ...change }
      void saveNoteDraft(draftKey, next)
      return next
    })

  const save = async () => {
    if (!form) return
    await run(async () => {
      if (editing) {
        await callBackground("popup.editNote", {
          vaultId: editing.vault.id,
          noteId: editing.note.id,
          note: form,
        })
      } else if (vaultId) {
        await callBackground("popup.saveNote", { vaultId, note: form })
      }
      await saveNoteDraft(draftKey, null)
      onDone()
    })
  }

  const canSave = !busy && form !== null && (editing !== null || vaultId)

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3">
        {!form && !message && (
          <div role="status" className="flex flex-col gap-4 py-1">
            <span className="sr-only">{t("common.loading")}</span>
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}
        {form && (
          <div className={cn("flex flex-col gap-3", FADE_IN)}>
            <FormField label={t("popup.edit.name")} htmlFor="note-name">
              <Input
                id="note-name"
                value={form.name}
                onChange={(event) => update({ name: event.target.value })}
                autoComplete="off"
                autoFocus={target.mode === "create"}
                required
              />
            </FormField>
            <FormField label={t("popup.note.content")} htmlFor="note-text">
              <Textarea
                id="note-text"
                rows={6}
                value={form.text}
                onChange={(event) => update({ text: event.target.value })}
              />
            </FormField>
            <FormField label={t("popup.detail.customFields")}>
              <CustomFieldsEditor
                fields={form.customFields}
                onChange={(customFields) => update({ customFields })}
              />
            </FormField>
            {target.mode === "create" && (
              <FormField label={t("popup.add.saveTo")}>
                <VaultSelect
                  vaults={target.targets}
                  value={vaultId}
                  onChange={setVaultId}
                  label={t("popup.add.saveTo")}
                />
              </FormField>
            )}
          </div>
        )}
        <FormError>{message}</FormError>
      </div>
      <Separator />
      <div className="flex gap-2 px-3 pt-2.5 pb-3">
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={onCancel}
          >
            {t("popup.edit.cancel")}
          </Button>
        )}
        <Button type="submit" className="flex-1" disabled={!canSave}>
          {t("popup.add.save")}
        </Button>
      </div>
    </form>
  )
}

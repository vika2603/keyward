import {
  CheckIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { useState } from "react"
import { callBackground } from "@/background/api"
import { errorMessage } from "@/components/keyward/errors"
import { nestedFolderChoices } from "@/components/keyward/folder-tree"
import { FormError } from "@/components/keyward/form-field"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { t } from "@/lib/i18n"
import type { Folder } from "@/lib/providers/types"

/** Create, rename, and delete Bitwarden folders (with `/` nesting support) inside the popup. */
export function FolderManagerDialog({
  open,
  onOpenChange,
  vaultId,
  folders,
  onChanged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  vaultId: string
  folders: readonly Folder[]
  onChanged: () => void
}) {
  const [newName, setNewName] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const choices = nestedFolderChoices(folders)

  const runAction = async (task: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await task()
      onChanged()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const create = () => {
    const trimmed = newName.trim()
    if (!trimmed) return
    void runAction(async () => {
      await callBackground("popup.createFolder", { vaultId, name: trimmed })
      setNewName("")
    })
  }

  const rename = (folderId: string) => {
    const trimmed = editingName.trim()
    if (!trimmed) return
    void runAction(async () => {
      await callBackground("popup.renameFolder", {
        vaultId,
        folderId,
        name: trimmed,
      })
      setEditingId(null)
    })
  }

  const remove = (folderId: string) => {
    void runAction(async () => {
      await callBackground("popup.deleteFolder", { vaultId, folderId })
      if (editingId === folderId) setEditingId(null)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[330px] gap-3 p-4">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {t("popup.folders.title")}
          </DialogTitle>
        </DialogHeader>
        <form
          className="flex gap-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            create()
          }}
        >
          <Input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder={t("popup.folders.newPlaceholder")}
            aria-label={t("popup.folders.newPlaceholder")}
            disabled={busy}
            autoComplete="off"
          />
          <Button
            type="submit"
            size="icon"
            disabled={busy || !newName.trim()}
            aria-label={t("popup.folders.create")}
            title={t("popup.folders.create")}
          >
            <PlusIcon />
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">
          {t("popup.folders.nestingHint")}
        </p>
        <div className="flex max-h-56 flex-col gap-1 overflow-y-auto">
          {choices.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">
              {t("popup.folders.empty")}
            </p>
          ) : (
            choices.map((folder) =>
              editingId === folder.id ? (
                <form
                  key={folder.id}
                  className="flex items-center gap-1"
                  onSubmit={(event) => {
                    event.preventDefault()
                    rename(folder.id)
                  }}
                >
                  <Input
                    value={editingName}
                    onChange={(event) => setEditingName(event.target.value)}
                    disabled={busy}
                    className="h-8 text-xs"
                    autoFocus
                  />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="icon-xs"
                    disabled={busy || !editingName.trim()}
                    aria-label={t("popup.folders.save")}
                  >
                    <CheckIcon />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    disabled={busy}
                    aria-label={t("popup.cancel")}
                    onClick={() => setEditingId(null)}
                  >
                    <XIcon />
                  </Button>
                </form>
              ) : (
                <div
                  key={folder.id}
                  className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-muted/60"
                >
                  <span
                    className="min-w-0 flex-1 truncate text-xs"
                    title={folder.name}
                  >
                    {folder.label}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    disabled={busy}
                    aria-label={t("popup.folders.rename")}
                    title={t("popup.folders.rename")}
                    onClick={() => {
                      setEditingId(folder.id)
                      setEditingName(folder.name)
                    }}
                  >
                    <PencilIcon />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    disabled={busy}
                    aria-label={t("popup.folders.delete")}
                    title={t("popup.folders.delete")}
                    onClick={() => remove(folder.id)}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              ),
            )
          )}
        </div>
        <FormError>{error}</FormError>
      </DialogContent>
    </Dialog>
  )
}

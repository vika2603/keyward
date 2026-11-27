import { useId } from "react"
import { nestedFolderChoices } from "@/components/keyward/folder-tree"
import { FormField } from "@/components/keyward/form-field"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { t } from "@/lib/i18n"
import type { Folder, VaultGroups } from "@/lib/providers/types"
import { NO_FOLDER } from "./main/group-filter"

const PERSONAL_OWNER = "personal"

/** Folder picker using Bitwarden's slash-delimited nested tree formatting. */
export function FolderSelectField({
  folders,
  value,
  onChange,
}: {
  folders: readonly Folder[]
  value: string | null
  onChange: (folderId: string | null) => void
}) {
  if (!folders.length) return null
  const folderChoices = [
    { value: NO_FOLDER, label: t("popup.main.filter.noFolder") },
    ...nestedFolderChoices(folders).map((folder) => ({
      value: folder.id,
      label: folder.label,
    })),
  ]
  return (
    <FormField label={t("popup.add.folder")}>
      <Select
        value={value ?? NO_FOLDER}
        onValueChange={(next) => onChange(next === NO_FOLDER ? null : next)}
        items={folderChoices}
      >
        <SelectTrigger className="w-full" aria-label={t("popup.add.folder")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {folderChoices.map((choice) => (
              <SelectItem key={choice.value} value={choice.value}>
                {choice.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </FormField>
  )
}

/** Owner (personal vs organization) and collection checkboxes for creating Bitwarden items. */
export function OwnerAndCollectionsField({
  groups,
  organizationId,
  collectionIds,
  onChange,
}: {
  groups: VaultGroups
  organizationId: string | null
  collectionIds: string[]
  onChange: (next: {
    organizationId: string | null
    collectionIds: string[]
  }) => void
}) {
  if (!groups.organizations.length) return null
  const ownerChoices = [
    { value: PERSONAL_OWNER, label: t("popup.main.filter.myVault") },
    ...groups.organizations.map((org) => ({ value: org.id, label: org.name })),
  ]
  const orgCollections = organizationId
    ? groups.collections.filter((c) => c.organizationId === organizationId)
    : []

  const toggleCollection = (id: string, checked: boolean) => {
    const next = checked
      ? [...new Set([...collectionIds, id])]
      : collectionIds.filter((existing) => existing !== id)
    onChange({ organizationId, collectionIds: next })
  }

  return (
    <>
      <FormField label={t("popup.add.owner")}>
        <Select
          value={organizationId ?? PERSONAL_OWNER}
          onValueChange={(next) => {
            const nextOrg = next === PERSONAL_OWNER ? null : next
            const defaultCollections = nextOrg
              ? groups.collections
                  .filter((c) => c.organizationId === nextOrg)
                  .slice(0, 1)
                  .map((c) => c.id)
              : []
            onChange({
              organizationId: nextOrg,
              collectionIds: defaultCollections,
            })
          }}
          items={ownerChoices}
        >
          <SelectTrigger className="w-full" aria-label={t("popup.add.owner")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {ownerChoices.map((choice) => (
                <SelectItem key={choice.value} value={choice.value}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </FormField>
      {organizationId && (
        <FormField label={t("popup.add.collections")}>
          <div className="flex flex-col gap-1.5 rounded-lg border border-input bg-background/50 p-2">
            {orgCollections.map((collection) => {
              const checked = collectionIds.includes(collection.id)
              return (
                <label
                  key={collection.id}
                  className="flex cursor-pointer items-center gap-2 text-xs"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(value) =>
                      toggleCollection(collection.id, value === true)
                    }
                  />
                  <span className="truncate">{collection.name}</span>
                </label>
              )
            })}
            {!collectionIds.length && (
              <p className="text-xs text-muted-foreground">
                {t("popup.add.needCollection")}
              </p>
            )}
          </div>
        </FormField>
      )}
    </>
  )
}

/** Master password re-prompt toggle for Bitwarden login and secure note forms. */
export function RepromptSwitchField({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border/70 px-3 py-2.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={id} className="text-xs font-medium">
          {t("popup.edit.reprompt")}
        </label>
        <p className="text-xs text-muted-foreground">
          {t("popup.edit.repromptHint")}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
      />
    </div>
  )
}

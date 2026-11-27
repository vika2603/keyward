import { ArchiveIcon, CopyPlusIcon, PencilIcon } from "lucide-react"
import { type ReactNode, useState } from "react"
import { callBackground } from "@/background/api"
import { BrandIcon, vaultLabel } from "@/components/keyward/brand-icon"
import { formatDate } from "@/components/keyward/format"
import { FADE_IN } from "@/components/keyward/loading"
import { notify } from "@/components/keyward/notify"
import { Button } from "@/components/ui/button"
import { t } from "@/lib/i18n"
import type { CustomField, VaultInfo } from "@/lib/providers/types"
import { cn } from "@/lib/utils"
import { BackHeader } from "../header"
import type { ArchiveInfo, TrashInfo } from "../views"
import {
  ArchiveActions,
  CustomFieldRow,
  DeleteButton,
  FavoriteButton,
  IconButton,
  InfoRow,
  requestOrNotify,
  Section,
  TrashActions,
  toggled,
} from "./detail-parts"

/** Clones a login or secure note and notifies on success. */
export function cloneVaultItem(
  vaultId: string,
  itemId: string,
  name: string,
  onDone: () => void,
): void {
  void requestOrNotify(async () => {
    await callBackground("popup.cloneItem", { vaultId, itemId })
    notify(t("popup.detail.cloned", { name }))
    onDone()
  })
}

/** A login's or note's header: back, and the star and edit buttons once the details tell. */
export function ItemDetailHeader({
  title,
  vaultId,
  itemId,
  details,
  onFavoriteChange,
  onBack,
  onEdit,
  onClone,
}: {
  title: string
  vaultId: string
  itemId: string
  details: { favorite?: boolean; editable: boolean } | null
  onFavoriteChange: (favorite: boolean) => void
  onBack: () => void
  onEdit: () => void
  onClone?: () => void
}) {
  return (
    <BackHeader title={title} onBack={onBack}>
      {details?.favorite !== undefined && (
        <FavoriteButton
          vaultId={vaultId}
          itemId={itemId}
          favorite={details.favorite}
          onChange={onFavoriteChange}
        />
      )}
      {details?.editable && onClone && (
        <IconButton label={t("popup.detail.clone")} onClick={onClone}>
          <CopyPlusIcon />
        </IconButton>
      )}
      {details?.editable && (
        <IconButton label={t("popup.detail.edit")} onClick={onEdit}>
          <PencilIcon />
        </IconButton>
      )}
    </BackHeader>
  )
}

/** The item's icon and name, over its details. */
export function ItemTitle({ icon, name }: { icon: ReactNode; name: string }) {
  return (
    <div className="flex items-center gap-3 px-1">
      {icon}
      <span className="min-w-0 truncate text-base font-medium">{name}</span>
    </div>
  )
}

/** The item's custom fields, each hidden one masked until it is shown. */
export function CustomFieldsSection({ fields }: { fields: CustomField[] }) {
  /** Indexes of the hidden fields the user revealed. */
  const [shownFields, setShownFields] = useState<ReadonlySet<number>>(
    () => new Set(),
  )
  if (!fields.length) return null
  return (
    <Section title={t("popup.detail.customFields")}>
      {fields.map((field, index) => (
        <CustomFieldRow
          // biome-ignore lint/suspicious/noArrayIndexKey: field names may repeat; their position is their identity.
          key={index}
          field={field}
          shown={shownFields.has(index)}
          onToggle={() => setShownFields((shown) => toggled(shown, index))}
        />
      ))}
    </Section>
  )
}

/** The Info card: the vault and dates, with rows of the item's kind before and after them. */
export function ItemInfoSection({
  vault,
  modified,
  created,
  leading,
  children,
}: {
  vault: VaultInfo
  modified?: number
  created?: number
  leading?: ReactNode
  children?: ReactNode
}) {
  return (
    <Section title={t("popup.detail.info")}>
      {leading}
      <InfoRow label={t("popup.detail.vault")}>
        <BrandIcon kind={vault.kind} className="size-3.5 shrink-0" />
        <span className="truncate">{vaultLabel(vault)}</span>
      </InfoRow>
      {modified !== undefined && (
        <InfoRow label={t("popup.detail.modified")}>
          {formatDate(modified)}
        </InfoRow>
      )}
      {created !== undefined && (
        <InfoRow label={t("popup.detail.created")}>
          {formatDate(created)}
        </InfoRow>
      )}
      {children}
    </Section>
  )
}

/** Shared bottom actions for a login or note: trash restore/purge, archive restore, or archive + delete. */
export function ItemLifecycleActions({
  vaultId,
  itemId,
  name,
  editable,
  trashed,
  archived,
  deleteHint,
  onDelete,
  onDone,
}: {
  vaultId: string
  itemId: string
  name: string
  editable: boolean
  trashed?: TrashInfo
  archived?: ArchiveInfo
  deleteHint: string
  onDelete: () => Promise<boolean>
  onDone: () => void
}) {
  if (trashed) {
    return (
      <TrashActions
        vaultId={vaultId}
        itemId={itemId}
        name={name}
        editable={trashed.editable}
        onDone={onDone}
      />
    )
  }
  if (archived) {
    return (
      <ArchiveActions
        vaultId={vaultId}
        itemId={itemId}
        name={name}
        editable={archived.editable}
        onDone={onDone}
      />
    )
  }
  if (!editable) return null
  const archive = () =>
    void requestOrNotify(async () => {
      await callBackground("popup.archiveItem", { vaultId, itemId })
      notify(t("popup.detail.archivedNotice", { name }))
      onDone()
    })
  return (
    <div className="flex flex-col gap-2">
      <Button variant="outline" onClick={archive}>
        <ArchiveIcon />
        {t("popup.detail.archive")}
      </Button>
      <DeleteButton hint={deleteHint} onDelete={onDelete} />
    </div>
  )
}

/** Fallback card shown when a trashed item's details could not be loaded (e.g. older background). */
export function TrashedFallbackSection({
  vault,
  itemId,
  name,
  trashed,
  onDone,
}: {
  vault: VaultInfo
  itemId: string
  name: string
  trashed: TrashInfo
  onDone: () => void
}) {
  return (
    <div className={cn("flex flex-col gap-3", FADE_IN)}>
      <ItemInfoSection vault={vault}>
        {trashed.deletedAt !== undefined && (
          <InfoRow label={t("popup.detail.deleted")}>
            {formatDate(trashed.deletedAt)}
          </InfoRow>
        )}
      </ItemInfoSection>
      <TrashActions
        vaultId={vault.id}
        itemId={itemId}
        name={name}
        editable={trashed.editable}
        onDone={onDone}
      />
    </div>
  )
}

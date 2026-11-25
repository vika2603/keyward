import { PencilIcon } from "lucide-react"
import { type ReactNode, useState } from "react"
import { BrandIcon, vaultLabel } from "@/components/keyward/brand-icon"
import { t } from "@/lib/i18n"
import type { CustomField, VaultInfo } from "@/lib/providers/types"
import { BackHeader } from "../header"
import {
  CustomFieldRow,
  FavoriteButton,
  formatDate,
  IconButton,
  InfoRow,
  Section,
  toggled,
} from "./detail-parts"

/** A login's or note's header: back, and the star and edit buttons once the details tell. */
export function ItemDetailHeader({
  title,
  vaultId,
  itemId,
  details,
  onFavoriteChange,
  onBack,
  onEdit,
}: {
  title: string
  vaultId: string
  itemId: string
  details: { favorite?: boolean; editable: boolean } | null
  onFavoriteChange: (favorite: boolean) => void
  onBack: () => void
  onEdit: () => void
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

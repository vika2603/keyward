import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { t } from "@/lib/i18n"
import type { VaultInfo } from "@/lib/providers/types"
import { BrandIcon, vaultLabel } from "./brand-icon"

/** Chooses the vault a login is saved to; each choice shows the provider's mark. */
export function VaultSelect({
  vaults,
  value,
  onChange,
  label,
  alignItemWithTrigger,
  onOpenChange,
}: {
  vaults: VaultInfo[]
  value: string | null
  onChange: (id: string) => void
  label: string
  alignItemWithTrigger?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  return (
    <Select
      value={value}
      onOpenChange={onOpenChange}
      onValueChange={(next) => {
        if (typeof next === "string") onChange(next)
      }}
      items={vaults.map((vault) => ({
        value: vault.id,
        label: vaultLabel(vault),
      }))}
      disabled={!vaults.length}
    >
      <SelectTrigger className="w-full" aria-label={label}>
        <SelectValue placeholder={t("common.noSaveTarget")}>
          {(id: string | null) => {
            const vault = vaults.find((candidate) => candidate.id === id)
            return vault ? (
              <span className="flex min-w-0 items-center gap-2">
                <BrandIcon kind={vault.kind} />
                <span className="truncate">{vaultLabel(vault)}</span>
              </span>
            ) : (
              t("common.noSaveTarget")
            )
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={alignItemWithTrigger}>
        <SelectGroup>
          {vaults.map((vault) => (
            <SelectItem key={vault.id} value={vault.id}>
              <BrandIcon kind={vault.kind} />
              <span className="truncate">{vaultLabel(vault)}</span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

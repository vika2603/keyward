import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { SourceInfo } from "@/lib/backends/types"
import { t } from "@/lib/i18n"
import { BrandIcon, sourceLabel } from "./brand-icon"

/** Chooses the source a login is saved to; each choice shows the backend's mark. */
export function SourceSelect({
  sources,
  value,
  onChange,
  label,
}: {
  sources: SourceInfo[]
  value: string | null
  onChange: (id: string) => void
  label: string
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (typeof next === "string") onChange(next)
      }}
      items={sources.map((s) => ({ value: s.id, label: sourceLabel(s) }))}
      disabled={!sources.length}
    >
      <SelectTrigger className="w-full" aria-label={label}>
        <SelectValue placeholder={t("common.noSaveTarget")}>
          {(id: string | null) => {
            const source = sources.find((s) => s.id === id)
            return source ? (
              <span className="flex min-w-0 items-center gap-2">
                <BrandIcon kind={source.kind} />
                <span className="truncate">{sourceLabel(source)}</span>
              </span>
            ) : (
              t("common.noSaveTarget")
            )
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {sources.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            <BrandIcon kind={s.kind} />
            <span className="truncate">{sourceLabel(s)}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

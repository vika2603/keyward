import { PlusIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { type MessageKey, t } from "@/lib/i18n"
import type { CustomField } from "@/lib/providers/types"
import { SecretInput } from "./secret-input"

type FieldKind = CustomField["kind"]
type LinkTarget = Extract<CustomField, { kind: "linked" }>["linkedTo"]

const KIND_LABELS: Record<FieldKind, MessageKey> = {
  text: "popup.edit.fieldKind.text",
  hidden: "popup.edit.fieldKind.hidden",
  checkbox: "popup.edit.fieldKind.checkbox",
  linked: "popup.edit.fieldKind.linked",
}
const KINDS = Object.keys(KIND_LABELS) as FieldKind[]

const LINK_LABELS: Record<LinkTarget, MessageKey> = {
  username: "popup.detail.username",
  password: "popup.detail.password",
}
const LINK_TARGETS = Object.keys(LINK_LABELS) as LinkTarget[]

/** The field turned into another kind; a value carries over between text and hidden fields. */
function withKind(field: CustomField, kind: FieldKind): CustomField {
  const value =
    field.kind === "text" || field.kind === "hidden" ? field.value : ""
  switch (kind) {
    case "text":
    case "hidden":
      return { kind, name: field.name, value }
    case "checkbox":
      return { kind, name: field.name, checked: false }
    case "linked":
      return { kind, name: field.name, linkedTo: "username" }
  }
}

/** A login's custom fields as a list of small forms, each with a name, a type and a value. */
export function CustomFieldsEditor({
  fields,
  onChange,
}: {
  fields: CustomField[]
  onChange: (fields: CustomField[]) => void
}) {
  const replace = (index: number, next: CustomField) =>
    onChange(
      fields.map((field, position) => (position === index ? next : field)),
    )
  const remove = (index: number) =>
    onChange(fields.filter((_, position) => position !== index))
  const add = () => onChange([...fields, { kind: "text", name: "", value: "" }])

  return (
    <div className="flex flex-col gap-1.5">
      {fields.map((field, index) => (
        <CustomFieldEditor
          // biome-ignore lint/suspicious/noArrayIndexKey: field names may repeat while typed; their position is their identity.
          key={index}
          field={field}
          onChange={(next) => replace(index, next)}
          onRemove={() => remove(index)}
        />
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-start"
        onClick={add}
      >
        <PlusIcon />
        {t("popup.edit.addField")}
      </Button>
    </div>
  )
}

function CustomFieldEditor({
  field,
  onChange,
  onRemove,
}: {
  field: CustomField
  onChange: (field: CustomField) => void
  onRemove: () => void
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg p-2 ring-1 ring-foreground/10">
      <div className="flex items-center gap-1">
        <Input
          value={field.name}
          placeholder={t("popup.edit.fieldName")}
          aria-label={t("popup.edit.fieldName")}
          onChange={(event) => onChange({ ...field, name: event.target.value })}
          autoComplete="off"
          spellCheck={false}
          required
        />
        <Select
          value={field.kind}
          onValueChange={(kind) => onChange(withKind(field, kind as FieldKind))}
          items={KINDS.map((kind) => ({
            value: kind,
            label: t(KIND_LABELS[kind]),
          }))}
        >
          <SelectTrigger
            className="w-28 shrink-0"
            aria-label={t("popup.edit.fieldKind")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {t(KIND_LABELS[kind])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("popup.edit.removeField")}
          title={t("popup.edit.removeField")}
          onClick={onRemove}
        >
          <XIcon />
        </Button>
      </div>
      <FieldValueEditor field={field} onChange={onChange} />
    </div>
  )
}

function FieldValueEditor({
  field,
  onChange,
}: {
  field: CustomField
  onChange: (field: CustomField) => void
}) {
  switch (field.kind) {
    case "text":
      return (
        <Input
          value={field.value}
          placeholder={t("popup.edit.fieldValue")}
          aria-label={t("popup.edit.fieldValue")}
          onChange={(event) =>
            onChange({ ...field, value: event.target.value })
          }
          autoComplete="off"
        />
      )
    case "hidden":
      return (
        <SecretInput
          showLabel={t("popup.detail.showField")}
          hideLabel={t("popup.detail.hideField")}
          value={field.value}
          placeholder={t("popup.edit.fieldValue")}
          aria-label={t("popup.edit.fieldValue")}
          onChange={(event) =>
            onChange({ ...field, value: event.target.value })
          }
        />
      )
    case "checkbox":
      return (
        <label className="flex items-center gap-2 px-1 py-1 text-sm">
          <Checkbox
            checked={field.checked}
            onCheckedChange={(checked) => onChange({ ...field, checked })}
          />
          {t("popup.edit.fieldChecked")}
        </label>
      )
    case "linked":
      return (
        <div className="flex items-center gap-2 px-1 text-sm">
          <span className="text-muted-foreground">
            {t("popup.edit.linkedTo")}
          </span>
          <Select
            value={field.linkedTo}
            onValueChange={(linkedTo) =>
              onChange({ ...field, linkedTo: linkedTo as LinkTarget })
            }
            items={LINK_TARGETS.map((target) => ({
              value: target,
              label: t(LINK_LABELS[target]),
            }))}
          >
            <SelectTrigger
              size="sm"
              className="w-28"
              aria-label={t("popup.edit.linkedTo")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LINK_TARGETS.map((target) => (
                <SelectItem key={target} value={target}>
                  {t(LINK_LABELS[target])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )
  }
}

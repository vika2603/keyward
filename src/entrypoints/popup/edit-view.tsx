import { PlusIcon, RefreshCcwDotIcon, XIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { callBackground } from "@/background/api"
import { errorMessage } from "@/components/keyward/errors"
import { FormError, FormField } from "@/components/keyward/form-field"
import { FADE_IN } from "@/components/keyward/loading"
import { matchNames } from "@/components/keyward/match-names"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { useAsyncAction } from "@/hooks/use-async-action"
import { generatePassword, getGeneratorOptions } from "@/lib/generator"
import { t } from "@/lib/i18n"
import type {
  EditableLogin,
  LoginSummary,
  VaultInfo,
  Website,
} from "@/lib/providers/types"
import { MatchType } from "@/lib/settings"
import { cn } from "@/lib/utils"
import { CodeKeyInput } from "./code-key-input"
import { CustomFieldsEditor } from "./custom-fields-editor"
import { BackHeader } from "./header"
import { SecretInput } from "./secret-input"

const DEFAULT_MATCH = "default"

/** How pages are compared with one website; the default follows the site rules and settings. */
function MatchSelect({
  value,
  onChange,
}: {
  value: MatchType | null
  onChange: (match: MatchType | null) => void
}) {
  const choices: [string, string][] = [
    [DEFAULT_MATCH, t("options.sites.match.default")],
    ...matchNames().map(([match, name]): [string, string] => [
      String(match),
      name,
    ]),
  ]
  return (
    <Select
      value={value === null ? DEFAULT_MATCH : String(value)}
      onValueChange={(next) =>
        onChange(next === DEFAULT_MATCH ? null : (Number(next) as MatchType))
      }
      items={choices.map(([choice, label]) => ({ value: choice, label }))}
    >
      <SelectTrigger
        size="sm"
        className="w-24 shrink-0 text-xs"
        aria-label={t("popup.edit.match")}
        title={t("popup.edit.match")}
      >
        <SelectValue className="truncate" />
      </SelectTrigger>
      <SelectContent align="end" className="w-auto min-w-(--anchor-width)">
        <SelectGroup>
          {choices.map(([choice, label]) => (
            <SelectItem key={choice} value={choice}>
              {label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

/**
 * A website as a background from before per-website matching sends and takes it, until the
 * extension reloads: the address alone.
 */
type BareAddress = string

function sentBareAddresses(received: readonly (Website | BareAddress)[]) {
  return received.some((website) => typeof website === "string")
}

function websitesOf(received: readonly (Website | BareAddress)[]): Website[] {
  return received.map((website) =>
    typeof website === "string" ? { uri: website, match: null } : website,
  )
}

/** The websites in the form the background takes them. */
function websitesFor(websites: Website[], bare: boolean): Website[] {
  if (!bare) return websites
  // The request is typed for the current background; an older one reads these as addresses.
  const addresses: BareAddress[] = websites.map((website) => website.uri)
  return addresses as unknown as Website[]
}

/** Changes a login's name, username, password, addresses, notes, authenticator key and custom fields. */
export function EditView({
  vault,
  login,
  onDone,
}: {
  vault: VaultInfo
  login: LoginSummary
  onDone: () => void
}) {
  const [form, setForm] = useState<EditableLogin | null>(null)
  const { busy, message, setMessage, run } = useAsyncAction()
  /** The password shows only when asked for, or once a new one was generated. */
  const [revealed, setRevealed] = useState(false)
  /**
   * Whether the background lists websites as bare addresses, as one from before per-website
   * matching does until the extension reloads; it takes them back the same way.
   */
  const [bareAddresses, setBareAddresses] = useState(false)

  useEffect(() => {
    callBackground("popup.editable", {
      vaultId: vault.id,
      loginId: login.id,
    }).then(
      (loaded) => {
        const uris = websitesOf(loaded.uris)
        setBareAddresses(sentBareAddresses(loaded.uris))
        setForm({
          ...loaded,
          uris: uris.length ? uris : [{ uri: "", match: null }],
        })
      },
      (error) => setMessage(errorMessage(error)),
    )
  }, [vault.id, login.id, setMessage])

  const update = (change: Partial<EditableLogin>) =>
    setForm((current) => (current ? { ...current, ...change } : current))
  const setWebsite = (index: number, change: Partial<Website>) =>
    form &&
    update({
      uris: form.uris.map((website, position) =>
        position === index ? { ...website, ...change } : website,
      ),
    })

  const generate = async () => {
    const generated = generatePassword(await getGeneratorOptions())
    update({ password: generated })
    setRevealed(true)
    await callBackground("generator.record", {
      password: generated,
      site: login.host ?? "",
    }).catch(() => {})
  }

  const save = async () => {
    if (!form) return
    const uris = form.uris.filter((website) => website.uri.trim() !== "")
    await run(async () => {
      await callBackground("popup.editLogin", {
        vaultId: vault.id,
        loginId: login.id,
        change: { ...form, uris: websitesFor(uris, bareAddresses) },
      })
      onDone()
    })
  }

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <BackHeader title={t("popup.edit.title")} onBack={onDone} />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3">
        {!form && !message && (
          <div role="status" className="flex flex-col gap-4 py-1">
            <span className="sr-only">{t("common.loading")}</span>
            {["w-12", "w-16", "w-10"].map((width) => (
              <div key={width} className="flex flex-col gap-2">
                <Skeleton className={cn("h-3.5", width)} />
                <Skeleton className="h-8 w-full" />
              </div>
            ))}
          </div>
        )}
        {form && (
          <div className={cn("flex flex-col gap-3", FADE_IN)}>
            <FormField label={t("popup.edit.name")} htmlFor="edit-name">
              <Input
                id="edit-name"
                value={form.name}
                onChange={(event) => update({ name: event.target.value })}
                autoComplete="off"
                required
              />
            </FormField>
            <FormField label={t("popup.add.username")} htmlFor="edit-username">
              <Input
                id="edit-username"
                value={form.username}
                onChange={(event) => update({ username: event.target.value })}
                autoComplete="off"
              />
            </FormField>
            <FormField label={t("popup.add.password")} htmlFor="edit-password">
              <SecretInput
                id="edit-password"
                showLabel={t("popup.detail.showPassword")}
                hideLabel={t("popup.detail.hidePassword")}
                shown={revealed}
                onShownChange={setRevealed}
                value={form.password}
                onChange={(event) => update({ password: event.target.value })}
                action={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={t("popup.add.generate")}
                    title={t("popup.add.generate")}
                    onClick={() => void generate()}
                  >
                    <RefreshCcwDotIcon />
                  </Button>
                }
              />
            </FormField>
            <FormField label={t("popup.detail.websites")}>
              <div className="flex flex-col gap-1.5">
                {form.uris.map((website, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: addresses may repeat while typed; their position is their identity.
                  <div key={index} className="flex flex-col gap-1">
                    <div className="flex items-center gap-1">
                      <Input
                        value={website.uri}
                        aria-label={t("popup.detail.websites")}
                        placeholder="https://example.com"
                        onChange={(event) =>
                          setWebsite(index, { uri: event.target.value })
                        }
                        autoComplete="off"
                        spellCheck={false}
                      />
                      {!bareAddresses && (
                        <MatchSelect
                          value={website.match}
                          onChange={(match) => setWebsite(index, { match })}
                        />
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("popup.edit.removeWebsite")}
                        title={t("popup.edit.removeWebsite")}
                        onClick={() =>
                          update({
                            uris: form.uris.filter(
                              (_, position) => position !== index,
                            ),
                          })
                        }
                      >
                        <XIcon />
                      </Button>
                    </div>
                    {website.match === MatchType.RegularExpression && (
                      <p className="text-xs text-muted-foreground">
                        {t("popup.edit.regularExpressionHint")}
                      </p>
                    )}
                  </div>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  onClick={() =>
                    update({ uris: [...form.uris, { uri: "", match: null }] })
                  }
                >
                  <PlusIcon />
                  {t("popup.edit.addWebsite")}
                </Button>
              </div>
            </FormField>
            <FormField label={t("popup.edit.codeKey")} htmlFor="edit-totp">
              <CodeKeyInput
                id="edit-totp"
                value={form.totp}
                onChange={(totp) => update({ totp })}
              />
            </FormField>
            <FormField label={t("popup.detail.notes")} htmlFor="edit-notes">
              <Textarea
                id="edit-notes"
                rows={3}
                value={form.notes}
                onChange={(event) => update({ notes: event.target.value })}
              />
            </FormField>
            <FormField label={t("popup.detail.customFields")}>
              <CustomFieldsEditor
                fields={form.customFields}
                onChange={(customFields) => update({ customFields })}
              />
            </FormField>
          </div>
        )}
        <FormError>{message}</FormError>
      </div>
      <Separator />
      <div className="flex gap-2 px-3 pt-2.5 pb-3">
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={onDone}
        >
          {t("popup.edit.cancel")}
        </Button>
        <Button type="submit" className="flex-1" disabled={busy || !form}>
          {t("popup.add.save")}
        </Button>
      </div>
    </form>
  )
}

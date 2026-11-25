import {
  EyeIcon,
  EyeOffIcon,
  PlusIcon,
  RefreshCcwDotIcon,
  XIcon,
} from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { callBackground } from "@/background/api"
import { errorMessage } from "@/components/keyward/errors"
import { FADE_IN } from "@/components/keyward/loading"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import type {
  EditableLogin,
  LoginSummary,
  SourceInfo,
} from "@/lib/backends/types"
import { generatePassword, generatorOptionsItem } from "@/lib/generator"
import { t } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { BackHeader } from "./header"

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={htmlFor} className="text-sm leading-none font-medium">
        {label}
      </label>
      {children}
    </div>
  )
}

/** Changes a login's name, username, password, addresses, notes and authenticator key. */
export function EditView({
  source,
  login,
  onDone,
}: {
  source: SourceInfo
  login: LoginSummary
  onDone: () => void
}) {
  const [form, setForm] = useState<EditableLogin | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  /** The password shows only when asked for, or once a new one was generated. */
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    callBackground("popup.editable", {
      sourceId: source.id,
      loginId: login.id,
    }).then(
      (loaded) =>
        setForm({ ...loaded, uris: loaded.uris.length ? loaded.uris : [""] }),
      (error) => setMessage(errorMessage(error)),
    )
  }, [source.id, login.id])

  const update = (change: Partial<EditableLogin>) =>
    setForm((current) => (current ? { ...current, ...change } : current))
  const setUri = (index: number, value: string) =>
    form && update({ uris: form.uris.map((u, i) => (i === index ? value : u)) })

  const generate = async () => {
    const generated = generatePassword(await generatorOptionsItem.getValue())
    update({ password: generated })
    setRevealed(true)
    await callBackground("generator.record", {
      password: generated,
      site: login.host ?? "",
    }).catch(() => {})
  }

  const save = async () => {
    if (!form) return
    setBusy(true)
    setMessage(null)
    try {
      await callBackground("popup.editLogin", {
        sourceId: source.id,
        loginId: login.id,
        change: form,
      })
      onDone()
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="flex max-h-[600px] flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <BackHeader title={t("popup.edit.title")} onBack={onDone} />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pt-1 pb-3">
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
            <Field label={t("popup.edit.name")} htmlFor="edit-name">
              <Input
                id="edit-name"
                value={form.name}
                onChange={(event) => update({ name: event.target.value })}
                autoComplete="off"
                required
              />
            </Field>
            <Field label={t("popup.add.username")} htmlFor="edit-username">
              <Input
                id="edit-username"
                value={form.username}
                onChange={(event) => update({ username: event.target.value })}
                autoComplete="off"
              />
            </Field>
            <Field label={t("popup.add.password")} htmlFor="edit-password">
              <div className="relative">
                <Input
                  id="edit-password"
                  type={revealed ? "text" : "password"}
                  className="pr-16 font-mono"
                  value={form.password}
                  onChange={(event) => update({ password: event.target.value })}
                  autoComplete="off"
                  spellCheck={false}
                />
                <div className="absolute top-0.5 right-0.5 flex">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={
                      revealed
                        ? t("popup.detail.hidePassword")
                        : t("popup.detail.showPassword")
                    }
                    title={
                      revealed
                        ? t("popup.detail.hidePassword")
                        : t("popup.detail.showPassword")
                    }
                    onClick={() => setRevealed((value) => !value)}
                  >
                    {revealed ? <EyeOffIcon /> : <EyeIcon />}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("popup.add.generate")}
                    title={t("popup.add.generate")}
                    onClick={() => void generate()}
                  >
                    <RefreshCcwDotIcon />
                  </Button>
                </div>
              </div>
            </Field>
            <Field label={t("popup.detail.websites")}>
              <div className="flex flex-col gap-1.5">
                {form.uris.map((uri, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: addresses may repeat while typed; their position is their identity.
                  <div key={index} className="flex items-center gap-1">
                    <Input
                      value={uri}
                      aria-label={t("popup.detail.websites")}
                      placeholder="https://example.com"
                      onChange={(event) => setUri(index, event.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("popup.edit.removeWebsite")}
                      title={t("popup.edit.removeWebsite")}
                      onClick={() =>
                        update({
                          uris: form.uris.filter((_, i) => i !== index),
                        })
                      }
                    >
                      <XIcon />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  onClick={() => update({ uris: [...form.uris, ""] })}
                >
                  <PlusIcon />
                  {t("popup.edit.addWebsite")}
                </Button>
              </div>
            </Field>
            <Field label={t("popup.edit.codeKey")} htmlFor="edit-totp">
              <Input
                id="edit-totp"
                className="font-mono"
                value={form.totp}
                placeholder={t("popup.edit.codeKeyHint")}
                onChange={(event) => update({ totp: event.target.value })}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <Field label={t("popup.detail.notes")} htmlFor="edit-notes">
              <textarea
                id="edit-notes"
                rows={3}
                value={form.notes}
                onChange={(event) => update({ notes: event.target.value })}
                className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-foreground/35 focus-visible:ring-3 focus-visible:ring-foreground/6 dark:bg-input/30"
              />
            </Field>
          </div>
        )}
        {message && <p className="text-xs text-destructive">{message}</p>}
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

import { ExternalLinkIcon, RefreshCcwDotIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { callBackground } from "@/background/api"
import { errorMessage } from "@/components/keyward/errors"
import { VaultSelect } from "@/components/keyward/vault-select"
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { generatePassword, getGeneratorOptions } from "@/lib/generator"
import { t } from "@/lib/i18n"
import type {
  CustomField,
  Folder,
  NewLoginDetails,
  VaultInfo,
} from "@/lib/providers/types"
import { CodeKeyInput } from "./code-key-input"
import { CustomFieldsEditor } from "./custom-fields-editor"
import { BackHeader } from "./header"
import { NoteForm } from "./note-form"

const NO_FOLDER = "none"

/**
 * The fields of a new login beyond its site, username and password, for a vault that keeps them:
 * a Bitwarden account. Apple's helper stores those three only.
 */
function LoginDetailsFields({
  vaultId,
  site,
  details,
  onChange,
}: {
  vaultId: string
  site: string
  details: NewLoginDetails
  onChange: (change: Partial<NewLoginDetails>) => void
}) {
  const [folders, setFolders] = useState<Folder[]>([])
  useEffect(() => {
    setFolders([])
    callBackground("popup.folders", { vaultId }).then(setFolders, () => {
      // Without its folders the login is saved outside every folder.
    })
  }, [vaultId])
  const folderChoices = [
    { value: NO_FOLDER, label: t("popup.main.filter.noFolder") },
    ...folders.map((folder) => ({ value: folder.id, label: folder.name })),
  ]

  return (
    <>
      <label className="flex flex-col gap-2">
        <span className="text-sm leading-none font-medium">
          {t("popup.edit.name")}
        </span>
        <Input
          value={details.name}
          placeholder={site}
          onChange={(event) => onChange({ name: event.target.value })}
          autoComplete="off"
        />
      </label>
      {folders.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-sm leading-none font-medium">
            {t("popup.add.folder")}
          </span>
          <Select
            value={details.folderId ?? NO_FOLDER}
            onValueChange={(value) =>
              onChange({ folderId: value === NO_FOLDER ? null : value })
            }
            items={folderChoices}
          >
            <SelectTrigger
              className="w-full"
              aria-label={t("popup.add.folder")}
            >
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
        </div>
      )}
      <div className="flex flex-col gap-2">
        <label htmlFor="add-totp" className="text-sm leading-none font-medium">
          {t("popup.edit.codeKey")}
        </label>
        <CodeKeyInput
          id="add-totp"
          value={details.totp}
          onChange={(totp) => onChange({ totp })}
        />
      </div>
      <label className="flex flex-col gap-2">
        <span className="text-sm leading-none font-medium">
          {t("popup.detail.notes")}
        </span>
        <textarea
          rows={3}
          value={details.notes}
          onChange={(event) => onChange({ notes: event.target.value })}
          className="w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-foreground/35 focus-visible:ring-3 focus-visible:ring-foreground/6 dark:bg-input/30"
        />
      </label>
      <div className="flex flex-col gap-2">
        <span className="text-sm leading-none font-medium">
          {t("popup.detail.customFields")}
        </span>
        <CustomFieldsEditor
          fields={details.customFields}
          onChange={(customFields: CustomField[]) => onChange({ customFields })}
        />
      </div>
    </>
  )
}

const EMPTY_DETAILS: NewLoginDetails = {
  name: "",
  notes: "",
  totp: "",
  customFields: [],
  folderId: null,
}

/** A new login: its site, username, password and the vault it goes to. */
function AddLoginForm({ onDone }: { onDone: () => void }) {
  const [site, setSite] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [targets, setTargets] = useState<VaultInfo[] | null>(null)
  const [unsupported, setUnsupported] = useState<VaultInfo[]>([])
  const [target, setTarget] = useState<string | null>(null)
  const [details, setDetails] = useState(EMPTY_DETAILS)
  // A folder belongs to one account, so another account starts outside every folder.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the folder resets whenever the target changes.
  useEffect(() => {
    setDetails((current) => ({ ...current, folderId: null }))
  }, [target])
  const request = useRef(0)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    void callBackground("popup.state", null).then((state) => {
      if (state.page) setSite((current) => current || state.page?.host || "")
    })
  }, [])

  // Which places can store the login depends on the site, so the choice follows it as it is typed.
  useEffect(() => {
    const id = ++request.current
    const timer = setTimeout(
      () =>
        void callBackground("popup.saveTargets", { site }).then((result) => {
          if (id !== request.current) return
          setTargets(result.targets)
          setUnsupported(result.unsupported)
          setTarget((current) =>
            result.targets.some((t) => t.id === current)
              ? current
              : result.defaultTarget,
          )
        }),
      // The first request runs at once; later ones wait for typing to pause.
      id === 1 ? 0 : 200,
    )
    return () => clearTimeout(timer)
  }, [site])

  const generate = async () => {
    const generated = generatePassword(await getGeneratorOptions())
    setPassword(generated)
    await callBackground("generator.record", {
      password: generated,
      site,
    }).catch(() => {})
  }

  const save = async () => {
    if (!target) return
    setBusy(true)
    setMessage(null)
    try {
      await callBackground("popup.saveLogin", {
        vaultId: target,
        site,
        username,
        password,
        details: bitwarden ? details : undefined,
      })
      onDone()
    } catch (error) {
      setMessage(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const targetKind = targets?.find((t) => t.id === target)?.kind
  const apple = targetKind === "apple"
  const bitwarden = targetKind === "bitwarden"

  // The Passwords app's own form also takes a title and notes, which Keyward cannot save there.
  const openNewPasswordSheet = async () => {
    setMessage(null)
    try {
      await callBackground("apple.openNewPasswordSheet", { site })
    } catch (error) {
      setMessage(errorMessage(error))
    }
  }
  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pt-1 pb-3">
        <label className="flex flex-col gap-2">
          <span className="text-sm leading-none font-medium">
            {t("popup.add.site")}
          </span>
          <Input
            value={site}
            onChange={(event) => setSite(event.target.value)}
            required
          />
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-sm leading-none font-medium">
            {t("popup.add.username")}
          </span>
          <Input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="off"
          />
        </label>
        <div className="flex flex-col gap-2">
          <label
            htmlFor="add-password"
            className="text-sm leading-none font-medium"
          >
            {t("popup.add.password")}
          </label>
          <div className="relative">
            <Input
              id="add-password"
              className="pr-9 font-mono"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              required
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute top-0.5 right-0.5"
              aria-label={t("popup.add.generate")}
              title={t("popup.add.generate")}
              onClick={() => void generate()}
            >
              <RefreshCcwDotIcon />
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm leading-none font-medium">
            {t("popup.add.saveTo")}
          </span>
          <VaultSelect
            vaults={targets ?? []}
            value={target}
            onChange={setTarget}
            label={t("popup.add.saveTo")}
          />
          {apple && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="self-start text-muted-foreground"
              onClick={() => void openNewPasswordSheet()}
            >
              <ExternalLinkIcon />
              {t("popup.add.openNewPasswordSheet")}
            </Button>
          )}
          {unsupported.some((vault) => vault.kind === "apple") ? (
            <p className="text-xs text-muted-foreground">
              {t("error.apple.unsupportedSite")}
            </p>
          ) : (
            targets?.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {t("popup.add.noTarget")}
              </p>
            )
          )}
        </div>
        {bitwarden && target && (
          <LoginDetailsFields
            vaultId={target}
            site={site}
            details={details}
            onChange={(change) =>
              setDetails((current) => ({ ...current, ...change }))
            }
          />
        )}
        {busy && apple && (
          <p className="text-xs text-muted-foreground">
            {t("popup.add.confirmOnMac")}
          </p>
        )}
        {message && <p className="text-xs text-destructive">{message}</p>}
      </div>
      <Separator />
      <div className="px-3 pt-2.5 pb-3">
        <Button
          type="submit"
          className="w-full"
          disabled={busy || !target || !site || !password}
        >
          {t("popup.add.save")}
        </Button>
      </div>
    </form>
  )
}

type AddKind = "login" | "note"

/** Adds a login, or a secure note when a ready vault keeps notes. */
export function AddView({ onBack }: { onBack: () => void }) {
  const [kind, setKind] = useState<AddKind>("login")
  const [noteTargets, setNoteTargets] = useState<VaultInfo[]>([])

  useEffect(() => {
    callBackground("popup.noteTargets", null).then(setNoteTargets, () => {
      // Without targets the view offers logins only.
    })
  }, [])

  const notesPossible = noteTargets.length > 0
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BackHeader
        title={
          kind === "note" ? t("popup.note.addTitle") : t("popup.add.title")
        }
        onBack={onBack}
      />
      {notesPossible && (
        <div className="px-3 pb-2">
          <Tabs
            value={kind}
            onValueChange={(value) => setKind(value as AddKind)}
          >
            <TabsList className="w-full">
              <TabsTrigger value="login">{t("popup.add.login")}</TabsTrigger>
              <TabsTrigger value="note">{t("popup.add.note")}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      )}
      {kind === "note" ? (
        <NoteForm
          target={{ mode: "create", targets: noteTargets }}
          onDone={onBack}
        />
      ) : (
        <AddLoginForm onDone={onBack} />
      )}
    </div>
  )
}

import { ExternalLinkIcon, RefreshCcwDotIcon } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { callBackground } from "@/background/api"
import { errorMessage, isUnsupportedRequest } from "@/components/keyward/errors"
import { FormError, FormField } from "@/components/keyward/form-field"
import { notifyError } from "@/components/keyward/notify"
import { SecretInput } from "@/components/keyward/secret-input"
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
import { Textarea } from "@/components/ui/textarea"
import { useAsyncAction } from "@/hooks/use-async-action"
import { useBackgroundQuery } from "@/hooks/use-background-query"
import { generatePassword, getGeneratorOptions } from "@/lib/generator"
import { t } from "@/lib/i18n"
import type {
  CustomField,
  NewLoginDetails,
  VaultInfo,
} from "@/lib/providers/types"
import { CodeKeyInput } from "./code-key-input"
import { CustomFieldsEditor } from "./custom-fields-editor"
import { BackHeader } from "./header"
import { NO_FOLDER } from "./main/group-filter"
import { NoteForm } from "./note-form"
import { loadAddDraft, saveAddDraft } from "./view-cache"

/** The places that can store a login are asked for once typing in the site pauses this long. */
const SITE_TYPING_DELAY_MS = 200

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
  // Without its folders the login is saved outside every folder.
  const { data: folders, error } = useBackgroundQuery("popup.folders", {
    vaultId,
  })
  /** A background from before these fields does not know the folder request, and drops the fields. */
  const detailsSupported = !isUnsupportedRequest(error)
  const folderChoices = [
    { value: NO_FOLDER, label: t("popup.main.filter.noFolder") },
    ...(folders ?? []).map((folder) => ({
      value: folder.id,
      label: folder.name,
    })),
  ]
  if (!detailsSupported) return null

  return (
    <>
      <FormField label={t("popup.edit.name")} htmlFor="add-name">
        <Input
          id="add-name"
          value={details.name}
          placeholder={site}
          onChange={(event) => onChange({ name: event.target.value })}
          autoComplete="off"
        />
      </FormField>
      {folders && folders.length > 0 && (
        <FormField label={t("popup.add.folder")}>
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
        </FormField>
      )}
      <FormField label={t("popup.edit.codeKey")} htmlFor="add-totp">
        <CodeKeyInput
          id="add-totp"
          value={details.totp}
          onChange={(totp) => onChange({ totp })}
        />
      </FormField>
      <FormField label={t("popup.detail.notes")} htmlFor="add-notes">
        <Textarea
          id="add-notes"
          rows={3}
          value={details.notes}
          onChange={(event) => onChange({ notes: event.target.value })}
        />
      </FormField>
      <FormField label={t("popup.detail.customFields")}>
        <CustomFieldsEditor
          fields={details.customFields}
          onChange={(customFields: CustomField[]) => onChange({ customFields })}
        />
      </FormField>
    </>
  )
}

const EMPTY_DETAILS: Omit<NewLoginDetails, "folderId"> = {
  name: "",
  notes: "",
  totp: "",
  customFields: [],
}

/** The vault a new login goes to, and its folder there. */
interface Destination {
  vaultId: string | null
  folderId: string | null
}

/** A new login: its site, username, password and the vault it goes to. */
function AddLoginForm({ onDone }: { onDone: () => void }) {
  const [site, setSite] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [revealed, setRevealed] = useState(false)
  const [targets, setTargets] = useState<VaultInfo[] | null>(null)
  const [unsupported, setUnsupported] = useState<VaultInfo[]>([])
  const [destination, setDestination] = useState<Destination>({
    vaultId: null,
    folderId: null,
  })
  const target = destination.vaultId
  /**
   * Chooses the vault from the one chosen so far. A folder belongs to one account, so another
   * account starts outside every folder.
   */
  const chooseTarget = useCallback(
    (choose: (current: string | null) => string | null) =>
      setDestination((current) => {
        const vaultId = choose(current.vaultId)
        return vaultId === current.vaultId
          ? current
          : { vaultId, folderId: null }
      }),
    [],
  )
  const [details, setDetails] = useState(EMPTY_DETAILS)
  const [draftLoaded, setDraftLoaded] = useState(false)
  /** Why no place could be found for the site; the site's places are unknown meanwhile. */
  const [targetsError, setTargetsError] = useState<string | null>(null)
  const siteRef = useRef<HTMLInputElement>(null)
  const usernameRef = useRef<HTMLInputElement>(null)
  const initialFocusDone = useRef(false)
  const request = useRef(0)
  const { busy, message, setMessage, run } = useAsyncAction()

  useEffect(() => {
    void loadAddDraft().then((draft) => {
      if (draft) {
        setSite(draft.site)
        setUsername(draft.username)
        setPassword(draft.password)
        setDestination({ vaultId: draft.vaultId, folderId: draft.folderId })
        setDetails(draft.details)
      }
      setDraftLoaded(true)
    })
  }, [])

  useEffect(() => {
    if (!draftLoaded) return
    const hasContent =
      Boolean(username) ||
      Boolean(password) ||
      Boolean(details.name) ||
      Boolean(details.notes) ||
      Boolean(details.totp) ||
      details.customFields.length > 0
    void saveAddDraft(
      hasContent
        ? {
            site,
            username,
            password,
            vaultId: destination.vaultId,
            folderId: destination.folderId,
            details,
          }
        : null,
    )
  }, [draftLoaded, site, username, password, destination, details])

  useEffect(() => {
    const focusInitial = (prefilledSite: boolean) => {
      if (initialFocusDone.current || document.activeElement !== document.body)
        return
      initialFocusDone.current = true
      ;(prefilledSite ? usernameRef.current : siteRef.current)?.focus()
    }
    callBackground("popup.state", null).then(
      (state) => {
        const host = state.page?.host || ""
        if (host) setSite((current) => current || host)
        focusInitial(Boolean(host))
      },
      (error) => {
        focusInitial(false)
        notifyError(error)
      },
    )
  }, [])

  // Which places can store the login depends on the site, so the choice follows it as it is typed.
  useEffect(() => {
    const id = ++request.current
    const timer = setTimeout(
      () =>
        callBackground("popup.saveTargets", { site }).then(
          (result) => {
            if (id !== request.current) return
            setTargets(result.targets)
            setUnsupported(result.unsupported)
            setTargetsError(null)
            chooseTarget((current) =>
              result.targets.some((candidate) => candidate.id === current)
                ? current
                : result.defaultTarget,
            )
          },
          (error) => {
            if (id !== request.current) return
            // The places found for the previous site may not take this one.
            setTargets([])
            setUnsupported([])
            chooseTarget(() => null)
            setTargetsError(errorMessage(error))
          },
        ),
      // The first request runs at once; later ones wait for typing to pause.
      id === 1 ? 0 : SITE_TYPING_DELAY_MS,
    )
    return () => clearTimeout(timer)
  }, [site, chooseTarget])

  const generate = async () => {
    const generated = generatePassword(await getGeneratorOptions())
    setPassword(generated)
    setRevealed(true)
    await callBackground("generator.record", {
      password: generated,
      site,
    }).catch(() => {})
  }

  const save = async () => {
    if (!target) return
    await run(async () => {
      await callBackground("popup.saveLogin", {
        vaultId: target,
        site,
        username,
        password,
        details: bitwarden
          ? { ...details, folderId: destination.folderId }
          : undefined,
      })
      await saveAddDraft(null)
      onDone()
    })
  }

  const targetKind = targets?.find((candidate) => candidate.id === target)?.kind
  const apple = targetKind === "apple"
  const bitwarden = targetKind === "bitwarden"
  // The Passwords helper saves no login without a password; other vaults keep one with only a
  // username.
  const hasCredential =
    Boolean(password) || (!apple && Boolean(username.trim()))
  const appleNeedsPassword = apple && !password && Boolean(username.trim())

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
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3">
        <FormField label={t("popup.add.site")} htmlFor="add-site">
          <Input
            id="add-site"
            ref={siteRef}
            value={site}
            onChange={(event) => setSite(event.target.value)}
            required
          />
        </FormField>
        <FormField label={t("popup.add.username")} htmlFor="add-username">
          <Input
            id="add-username"
            ref={usernameRef}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="off"
          />
        </FormField>
        <FormField label={t("popup.add.password")} htmlFor="add-password">
          <SecretInput
            id="add-password"
            showLabel={t("popup.detail.showPassword")}
            hideLabel={t("popup.detail.hidePassword")}
            shown={revealed}
            onShownChange={setRevealed}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required={apple}
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
          {appleNeedsPassword && (
            <p className="text-xs text-muted-foreground">
              {t("popup.add.appleNeedsPassword")}
            </p>
          )}
        </FormField>
        <FormField label={t("popup.add.saveTo")}>
          <VaultSelect
            vaults={targets ?? []}
            value={target}
            onChange={(vaultId) => chooseTarget(() => vaultId)}
            label={t("popup.add.saveTo")}
          />
          {/* In a block of its own, so the field does not stretch the button across. */}
          {apple && (
            <div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-ml-2 text-muted-foreground"
                onClick={() => void openNewPasswordSheet()}
              >
                <ExternalLinkIcon />
                {t("popup.add.openNewPasswordSheet")}
              </Button>
            </div>
          )}
          <TargetsNote
            error={targetsError}
            appleRefusesSite={unsupported.some(
              (vault) => vault.kind === "apple",
            )}
            noTarget={targets?.length === 0}
          />
        </FormField>
        {bitwarden && target && (
          <LoginDetailsFields
            vaultId={target}
            site={site}
            details={{ ...details, folderId: destination.folderId }}
            onChange={({ folderId, ...change }) => {
              if (folderId !== undefined)
                setDestination((current) => ({ ...current, folderId }))
              setDetails((current) => ({ ...current, ...change }))
            }}
          />
        )}
        {busy && apple && (
          <p className="text-xs text-muted-foreground">
            {t("popup.add.confirmOnMac")}
          </p>
        )}
        <FormError>{message}</FormError>
      </div>
      <Separator />
      <div className="px-3 pt-2.5 pb-3">
        <Button
          type="submit"
          className="w-full"
          disabled={busy || !target || !site || !hasCredential}
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
  // Without targets, as when the request fails, the view offers logins only.
  const { data: noteTargets } = useBackgroundQuery("popup.noteTargets", null)

  const notesPossible = noteTargets !== null && noteTargets.length > 0
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BackHeader
        title={
          kind === "note" ? t("popup.note.addTitle") : t("popup.add.title")
        }
        bordered={!notesPossible}
        onBack={onBack}
      />
      {notesPossible && (
        <div className="border-b border-border/70 px-3 pb-2.5">
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
      {kind === "note" && noteTargets ? (
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

/** Why the login has fewer places to go, or none: the targets' error, Apple refusing the site, or no place. */
function TargetsNote({
  error,
  appleRefusesSite,
  noTarget,
}: {
  error: string | null
  appleRefusesSite: boolean
  noTarget: boolean
}) {
  if (error) return <FormError>{error}</FormError>
  if (appleRefusesSite)
    return (
      <p className="text-xs text-muted-foreground">
        {t("error.apple.unsupportedSite")}
      </p>
    )
  if (noTarget)
    return (
      <p className="text-xs text-muted-foreground">{t("popup.add.noTarget")}</p>
    )
  return null
}

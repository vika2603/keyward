import { XIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { PromptState } from "@/background/api"
import { useAppearance } from "@/components/keyward/appearance"
import { BrandIcon, vaultLabel } from "@/components/keyward/brand-icon"
import { errorMessage, isUnsupportedRequest } from "@/components/keyward/errors"
import { useLanguage } from "@/components/keyward/language"
import {
  callOverlay,
  useClickGuard,
  useReportHeight,
} from "@/components/keyward/overlay-frame"
import { SiteIcon } from "@/components/keyward/site-icon"
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
import { PROMPT_WIDTH } from "@/content/overlay-size"
import { t } from "@/lib/i18n"
import type { Folder } from "@/lib/providers/types"

const NO_FOLDER = "none"

/** Asks to save or update a login after the user signed in; shown at the top right of the page. */
export function App() {
  useAppearance()
  const language = useLanguage()
  const card = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<PromptState | null>(null)
  const [target, setTarget] = useState<string | null>(null)
  /** The new login's name; empty names it after the site. */
  const [name, setName] = useState("")
  const [folders, setFolders] = useState<Folder[]>([])
  const [folderId, setFolderId] = useState<string | null>(null)
  /** A background from before names and folders does not know the folder request, and drops the name. */
  const [named, setNamed] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useReportHeight(
    card,
    state !== null && language !== null,
    (height) => void callOverlay("prompt.resize", { height }).catch(() => {}),
  )
  const clickCounts = useClickGuard(card, state !== null && language !== null)
  const guarded = (action: () => void) => () => {
    if (clickCounts()) action()
    else setMessage(t("overlay.prompt.guard"))
  }

  useEffect(() => {
    callOverlay("prompt.state", {}).then(
      (next) => {
        setState(next)
        setTarget(next.defaultTarget)
      },
      () => void callOverlay("prompt.close", {}).catch(() => {}),
    )
  }, [])

  const confirm = async () => {
    if (!clickCounts()) {
      setMessage(t("overlay.prompt.guard"))
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      await callOverlay("prompt.confirm", {
        targetId: target,
        name: bitwardenTarget ? name : "",
        folderId: bitwardenTarget ? folderId : null,
      })
    } catch (error) {
      setMessage(errorMessage(error))
      setBusy(false)
    }
  }

  const update = state?.mode === "update"
  const targetKind = state?.targets.find((vault) => vault.id === target)?.kind
  const appleTarget = update
    ? state?.updateVault?.kind === "apple"
    : targetKind === "apple"
  // A Bitwarden login keeps a name and a folder of its own; Apple names logins after their site.
  const bitwardenTarget = !update && targetKind === "bitwarden"

  useEffect(() => {
    setFolders([])
    setFolderId(null)
    if (!bitwardenTarget || !target) return
    let current = true
    callOverlay("prompt.folders", { vaultId: target }).then(
      (found) => current && setFolders(found),
      (error) => {
        // Without its folders the login is saved outside every folder.
        if (current && isUnsupportedRequest(error)) setNamed(false)
      },
    )
    return () => {
      current = false
    }
  }, [bitwardenTarget, target])
  const folderChoices = [
    { value: NO_FOLDER, label: t("overlay.prompt.noFolder") },
    ...folders.map((folder) => ({ value: folder.id, label: folder.name })),
  ]

  return (
    <div className="p-2">
      <div
        ref={card}
        style={{ width: PROMPT_WIDTH }}
        className="flex flex-col gap-3 rounded-lg bg-popover p-3 text-popover-foreground shadow-md ring-1 ring-foreground/10"
      >
        {state && language && (
          <>
            <div className="flex items-center gap-2">
              <h1 className="flex-1 text-sm font-medium">
                {update
                  ? t("overlay.prompt.updateTitle")
                  : t("overlay.prompt.saveTitle")}
              </h1>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("overlay.prompt.close")}
                onClick={() =>
                  void callOverlay("prompt.close", {}).catch(() => {})
                }
              >
                <XIcon />
              </Button>
            </div>
            <div className="flex items-center gap-2.5">
              <SiteIcon host={state.host} text={state.host} />
              <div className="flex min-w-0 flex-1 flex-col gap-px">
                <span className="truncate text-sm font-medium">
                  {state.username}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {state.host}
                </span>
              </div>
            </div>
            {update ? (
              state.updateVault && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <BrandIcon kind={state.updateVault.kind} />
                  <span className="min-w-0">
                    {t("overlay.prompt.willUpdate", {
                      vault: vaultLabel(state.updateVault),
                    })}
                  </span>
                </p>
              )
            ) : (
              // The vault comes first: the fields after it depend on it, so choosing another one
              // does not move the vault picker.
              <div className="flex flex-col gap-3">
                <div className="flex min-w-0 flex-col gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t("overlay.prompt.saveTo")}
                  </span>
                  <VaultSelect
                    vaults={state.targets}
                    value={target}
                    onChange={setTarget}
                    label={t("overlay.prompt.saveTo")}
                  />
                </div>
                {bitwardenTarget && named && (
                  <label className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      {t("overlay.prompt.name")}
                    </span>
                    <Input
                      value={name}
                      placeholder={state.host}
                      onChange={(event) => setName(event.target.value)}
                      autoComplete="off"
                    />
                  </label>
                )}
                {folders.length > 0 && (
                  <div className="flex min-w-0 flex-col gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      {t("overlay.prompt.folder")}
                    </span>
                    <Select
                      value={folderId ?? NO_FOLDER}
                      onValueChange={(value) =>
                        setFolderId(value === NO_FOLDER ? null : value)
                      }
                      items={folderChoices}
                    >
                      <SelectTrigger
                        className="w-full min-w-0"
                        aria-label={t("overlay.prompt.folder")}
                      >
                        <SelectValue className="truncate" />
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
              </div>
            )}
            {busy && appleTarget && (
              <p className="text-xs text-muted-foreground">
                {t("overlay.prompt.confirmOnMac")}
              </p>
            )}
            {message && <p className="text-xs text-destructive">{message}</p>}
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                disabled={busy}
                onClick={guarded(
                  () => void callOverlay("prompt.never", {}).catch(() => {}),
                )}
              >
                {t("overlay.prompt.never")}
              </Button>
              <Button
                className="ml-auto"
                disabled={busy || (!update && !target)}
                onClick={() => void confirm()}
              >
                {update ? t("overlay.prompt.update") : t("overlay.prompt.save")}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

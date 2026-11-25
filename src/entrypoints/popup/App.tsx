import { useEffect, useRef, useState } from "react"
import { callBackground, type PopupView } from "@/background/api"
import { useAppearance } from "@/components/keyward/appearance"
import { useLanguage } from "@/components/keyward/language"
import { notifyError } from "@/components/keyward/notify"
import { Toaster } from "@/components/ui/toast"
import { t } from "@/lib/i18n"
import type {
  LoginSummary,
  NoteSummary,
  VaultInfo,
} from "@/lib/providers/types"
import { AddView } from "./add-view"
import { CodeSetupView } from "./code-setup-view"
import { ConnectView } from "./connect-view"
import { DetailView } from "./detail-view"
import { EditView } from "./edit-view"
import { GeneratorView } from "./generator-view"
import { BackHeader } from "./header"
import { HistoryView } from "./history-view"
import { MainView, newListPlace } from "./main-view"
import { NoteForm } from "./note-form"
import { NoteView } from "./note-view"
import { PasswordHistoryView } from "./password-history-view"
import {
  fitWindow,
  isPoppedOut,
  PopOutContext,
  popOut,
  takePoppedView,
} from "./pop-out"

export type View =
  | PopupView
  | { name: "add" }
  | { name: "history" }
  | { name: "detail"; vault: VaultInfo; login: LoginSummary }
  | { name: "edit"; vault: VaultInfo; login: LoginSummary }
  | { name: "passwordHistory"; vault: VaultInfo; login: LoginSummary }
  | { name: "note"; vault: VaultInfo; note: NoteSummary }
  | { name: "editNote"; vault: VaultInfo; note: NoteSummary }

/**
 * Views that stay in the popup: their typed input is not handed to the new window, and closing the
 * popup ends a pairing in progress.
 */
const STAYS_IN_POPUP: ReadonlySet<View["name"]> = new Set([
  "add",
  "edit",
  "editNote",
  "connect",
  "codeSetup",
])

// Requested once per popup: the background hands out a pending view only to the first request. A
// popped-out window opens on the view it was popped out from.
const initialView: Promise<View> = isPoppedOut
  ? takePoppedView().then((view) => (view as View | null) ?? { name: "main" })
  : callBackground("popup.takeView", null).catch(
      (): PopupView => ({ name: "main" }),
    )

export function App() {
  const density = useAppearance()
  const language = useLanguage()
  const [view, setView] = useState<View | null>(null)
  /** The main view's search, kept while a found login's details are open. */
  const [query, setQuery] = useState("")
  /** Where the main list was left, kept the same way. */
  const listPlace = useRef(newListPlace())

  useEffect(() => {
    void initialView.then(setView)
    if (isPoppedOut) void fitWindow().catch(() => {})
  }, [])

  if (!language) return null
  const main = () => setView({ name: "main" })
  return (
    // A fixed size, as Chrome keeps a popup's size while it is open; every view fills it and
    // scrolls its own content.
    <Toaster closeLabel={t("common.close")}>
      <PopOutContext
        value={
          isPoppedOut || !view || STAYS_IN_POPUP.has(view.name)
            ? null
            : () => void popOut(view).catch(notifyError)
        }
      >
        <div className="flex h-[600px] w-[380px] flex-col">
          {view?.name === "main" && (
            <MainView
              density={density}
              query={query}
              onQuery={setQuery}
              place={listPlace.current}
              onNavigate={setView}
            />
          )}
          {view?.name === "add" && <AddView onBack={main} />}
          {view?.name === "detail" && (
            <DetailView
              vault={view.vault}
              login={view.login}
              onBack={main}
              onEdit={() => setView({ ...view, name: "edit" })}
              onPasswordHistory={() =>
                setView({ ...view, name: "passwordHistory" })
              }
            />
          )}
          {view?.name === "note" && (
            <NoteView
              vault={view.vault}
              note={view.note}
              onBack={main}
              onEdit={() => setView({ ...view, name: "editNote" })}
            />
          )}
          {view?.name === "editNote" && (
            <div className="flex min-h-0 flex-1 flex-col">
              <BackHeader
                title={t("popup.note.editTitle")}
                onBack={() => setView({ ...view, name: "note" })}
              />
              <NoteForm
                target={{ mode: "edit", vault: view.vault, note: view.note }}
                onDone={() => setView({ ...view, name: "note" })}
                onCancel={() => setView({ ...view, name: "note" })}
              />
            </div>
          )}
          {view?.name === "passwordHistory" && (
            <PasswordHistoryView
              vault={view.vault}
              login={view.login}
              onBack={() => setView({ ...view, name: "detail" })}
            />
          )}
          {view?.name === "edit" && (
            <EditView
              vault={view.vault}
              login={view.login}
              onDone={() => setView({ ...view, name: "detail" })}
            />
          )}
          {view?.name === "generator" && (
            <GeneratorView
              onBack={main}
              onHistory={() => setView({ name: "history" })}
            />
          )}
          {view?.name === "history" && (
            <HistoryView onBack={() => setView({ name: "generator" })} />
          )}
          {view?.name === "codeSetup" && (
            <CodeSetupView
              onBack={main}
              onConnect={(vault) =>
                setView({
                  name: "connect",
                  kind: vault.kind,
                  vaultId: vault.id,
                  back: "codeSetup",
                })
              }
            />
          )}
          {view?.name === "connect" && (
            <ConnectView
              kind={view.kind}
              vaultId={view.vaultId}
              onDone={
                view.back === "codeSetup"
                  ? () => setView({ name: "codeSetup" })
                  : main
              }
            />
          )}
        </div>
      </PopOutContext>
    </Toaster>
  )
}

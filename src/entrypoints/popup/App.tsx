import { useEffect, useRef, useState } from "react"
import { callBackground, type PopupView } from "@/background/api"
import { useAppearance } from "@/components/keyward/appearance"
import { useLanguage } from "@/components/keyward/language"
import { notifyError } from "@/components/keyward/notify"
import { Toaster } from "@/components/ui/toast"
import { t } from "@/lib/i18n"
import type { NoteSummary, VaultInfo } from "@/lib/providers/types"
import type { Settings } from "@/lib/settings"
import { AddView } from "./add-view"
import { CodeSetupView } from "./code-setup-view"
import { ConnectView } from "./connect-view"
import { DetailView } from "./detail/detail-view"
import { NoteView } from "./detail/note-view"
import { PasswordHistoryView } from "./detail/password-history-view"
import { EditView } from "./edit-view"
import { GeneratorView } from "./generator/generator-view"
import { BackHeader } from "./header"
import { HistoryView } from "./history-view"
import { type ListPlace, newListPlace } from "./main/list-place"
import { MainView } from "./main/main-view"
import { NoteForm } from "./note-form"
import {
  fitWindow,
  isPoppedOut,
  POPUP_HEIGHT,
  POPUP_WIDTH,
  PopOutContext,
  popOut,
  takePoppedView,
} from "./pop-out"
import type { View } from "./views"

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
  ? takePoppedView().then((view) => view ?? { name: "main" })
  : callBackground("popup.takeView", null).catch(
      (): PopupView => ({ name: "main" }),
    )

/** A secure note's form, to change it; going back returns to the note. */
function EditNoteView({
  vault,
  note,
  onBack,
}: {
  vault: VaultInfo
  note: NoteSummary
  onBack: () => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BackHeader title={t("popup.note.editTitle")} onBack={onBack} />
      <NoteForm
        target={{ mode: "edit", vault, note }}
        onDone={onBack}
        onCancel={onBack}
      />
    </div>
  )
}

function CurrentView({
  view,
  onNavigate,
  density,
  query,
  onQuery,
  listPlace,
}: {
  view: View
  onNavigate: (view: View) => void
  density: Settings["density"]
  query: string
  onQuery: (query: string) => void
  listPlace: ListPlace
}) {
  const backToMain = () => onNavigate({ name: "main" })
  switch (view.name) {
    case "main":
      return (
        <MainView
          density={density}
          query={query}
          onQuery={onQuery}
          place={listPlace}
          onNavigate={onNavigate}
        />
      )
    case "add":
      return <AddView onBack={backToMain} />
    case "detail":
      return (
        <DetailView
          vault={view.vault}
          login={view.login}
          onBack={backToMain}
          onEdit={() => onNavigate({ ...view, name: "edit" })}
          onPasswordHistory={() =>
            onNavigate({ ...view, name: "passwordHistory" })
          }
        />
      )
    case "note":
      return (
        <NoteView
          vault={view.vault}
          note={view.note}
          onBack={backToMain}
          onEdit={() => onNavigate({ ...view, name: "editNote" })}
        />
      )
    case "editNote":
      return (
        <EditNoteView
          vault={view.vault}
          note={view.note}
          onBack={() => onNavigate({ ...view, name: "note" })}
        />
      )
    case "passwordHistory":
      return (
        <PasswordHistoryView
          vault={view.vault}
          login={view.login}
          onBack={() => onNavigate({ ...view, name: "detail" })}
        />
      )
    case "edit":
      return (
        <EditView
          vault={view.vault}
          login={view.login}
          onDone={() => onNavigate({ ...view, name: "detail" })}
        />
      )
    case "generator":
      return (
        <GeneratorView
          onBack={backToMain}
          onHistory={() => onNavigate({ name: "history" })}
        />
      )
    case "history":
      return <HistoryView onBack={() => onNavigate({ name: "generator" })} />
    case "codeSetup":
      return (
        <CodeSetupView
          onBack={backToMain}
          onConnect={(vault) =>
            onNavigate({
              name: "connect",
              kind: vault.kind,
              vaultId: vault.id,
              back: "codeSetup",
            })
          }
        />
      )
    case "connect":
      return (
        <ConnectView
          kind={view.kind}
          vaultId={view.vaultId}
          onDone={
            view.back === "codeSetup"
              ? () => onNavigate({ name: "codeSetup" })
              : backToMain
          }
        />
      )
    default: {
      const unknown: never = view
      return unknown
    }
  }
}

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
  return (
    <Toaster closeLabel={t("common.close")}>
      <PopOutContext
        value={
          isPoppedOut || !view || STAYS_IN_POPUP.has(view.name)
            ? null
            : () => void popOut(view).catch(notifyError)
        }
      >
        {/* A fixed size, as Chrome keeps a popup's size while it is open; every view fills it and
            scrolls its own content. */}
        <div
          className="flex flex-col"
          style={{ width: POPUP_WIDTH, height: POPUP_HEIGHT }}
        >
          {view && (
            <CurrentView
              view={view}
              onNavigate={setView}
              density={density}
              query={query}
              onQuery={setQuery}
              listPlace={listPlace.current}
            />
          )}
        </div>
      </PopOutContext>
    </Toaster>
  )
}

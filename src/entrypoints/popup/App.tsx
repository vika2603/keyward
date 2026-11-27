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
import { BackHeader, openConnectPage } from "./header"
import { HistoryView } from "./history-view"
import { HttpAuthView } from "./http-auth-view"
import { type ListPlace, newListPlace } from "./main/list-place"
import { MainView } from "./main/main-view"
import { NoteForm } from "./note-form"
import { PasskeyView } from "./passkey-view"
import {
  fitWindow,
  isPoppedOut,
  POPUP_HEIGHT,
  POPUP_WIDTH,
  PopOutContext,
  popOut,
  takePoppedView,
} from "./pop-out"
import { SecurityView } from "./security-view"
import {
  clearViewCache,
  deserializeListPlace,
  loadViewCache,
  saveNavigationState,
} from "./view-cache"
import type { View } from "./views"

/**
 * Views that stay in the popup: their typed input is not handed to the new window, closing the
 * popup ends a pairing in progress, and it leaves a site asking for a login to the browser.
 */
const STAYS_IN_POPUP: ReadonlySet<View["name"]> = new Set([
  "add",
  "edit",
  "editNote",
  "connect",
  "codeSetup",
  "httpAuth",
  "passkey",
])

/** The view that Back and Escape return to from a subview; null on the main view. */
function parentViewOf(view: View): View | null {
  switch (view.name) {
    case "main":
    case "httpAuth":
    case "passkey":
      return null
    case "add":
    case "detail":
    case "note":
    case "generator":
    case "codeSetup":
    case "security":
      return { name: "main" }
    case "edit":
    case "passwordHistory": {
      const { name: _ignored, ...rest } = view
      return { name: "detail", ...rest }
    }
    case "editNote":
      return { name: "note", vault: view.vault, note: view.note }
    case "history":
      return { name: "generator" }
    case "connect":
      return view.back ? { name: view.back } : { name: "main" }
    default: {
      const unknown: never = view
      return unknown
    }
  }
}

function hasOpenPopupLayer(): boolean {
  return (
    document.querySelector(
      "[data-slot='select-content'], [data-slot='dialog-content'], [data-slot='alert-dialog-content']",
    ) !== null
  )
}

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
  const back = () => {
    const parent = parentViewOf(view)
    if (parent) onNavigate(parent)
  }
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
      return <AddView onBack={back} />
    case "detail":
      return (
        <DetailView
          vault={view.vault}
          login={view.login}
          trashed={view.trashed}
          archived={view.archived}
          onBack={back}
          onEdit={() =>
            onNavigate({ name: "edit", vault: view.vault, login: view.login })
          }
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
          trashed={view.trashed}
          archived={view.archived}
          onBack={back}
          onEdit={() =>
            onNavigate({ name: "editNote", vault: view.vault, note: view.note })
          }
        />
      )
    case "editNote":
      return <EditNoteView vault={view.vault} note={view.note} onBack={back} />
    case "passwordHistory":
      return (
        <PasswordHistoryView
          vault={view.vault}
          login={view.login}
          onBack={back}
        />
      )
    case "edit":
      return <EditView vault={view.vault} login={view.login} onDone={back} />
    case "generator":
      return (
        <GeneratorView
          onBack={back}
          onHistory={() => onNavigate({ name: "history" })}
          onUnlock={(vaultId) =>
            onNavigate({
              name: "connect",
              kind: "bitwarden",
              vaultId,
              back: "generator",
            })
          }
        />
      )
    case "history":
      return <HistoryView onBack={back} />
    case "security":
      return (
        <SecurityView
          onBack={back}
          onOpenLogin={(vault, login) =>
            onNavigate({ name: "detail", vault, login })
          }
        />
      )
    case "codeSetup":
      return (
        <CodeSetupView
          onBack={back}
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
        <ConnectView kind={view.kind} vaultId={view.vaultId} onDone={back} />
      )
    case "httpAuth":
      return (
        <HttpAuthView
          onConnect={(vault) =>
            vault.needsSetup
              ? openConnectPage()
              : onNavigate({
                  name: "connect",
                  kind: vault.kind,
                  vaultId: vault.id,
                  back: "httpAuth",
                })
          }
        />
      )
    case "passkey":
      return (
        <PasskeyView
          onConnect={(vault) =>
            onNavigate({
              name: "connect",
              kind: vault.kind,
              vaultId: vault.id,
              back: "passkey",
            })
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
    void initialView.then(async (resolved) => {
      if (!isPoppedOut && resolved.name === "main") {
        const cached = await loadViewCache()
        if (cached) {
          listPlace.current = deserializeListPlace(cached.place)
          setQuery(cached.query)
          setView(cached.view)
          return
        }
      }
      setView(resolved)
    })
    if (isPoppedOut) void fitWindow().catch(() => {})
  }, [])

  useEffect(() => {
    if (!view || isPoppedOut) return
    void saveNavigationState(view, query, listPlace.current)
  }, [view, query])

  useEffect(() => {
    const onScrollOrHide = () => {
      if (!view || isPoppedOut) return
      void saveNavigationState(view, query, listPlace.current)
    }
    window.addEventListener("pagehide", onScrollOrHide)
    return () => window.removeEventListener("pagehide", onScrollOrHide)
  }, [view, query])

  useEffect(() => {
    const onLock = (changes: Record<string, unknown>, area: string) => {
      // Nothing to clear unless lockAll explicitly clears cache via MainView.
      if (area === "session" && Object.keys(changes).length === 0)
        void clearViewCache()
    }
    browser.storage.onChanged.addListener(onLock)
    return () => browser.storage.onChanged.removeListener(onLock)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        event.isComposing ||
        hasOpenPopupLayer()
      )
        return
      const parent = view ? parentViewOf(view) : null
      if (!parent) return
      event.preventDefault()
      setView(parent)
    }
    addEventListener("keydown", onKey)
    return () => removeEventListener("keydown", onKey)
  }, [view])

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
        {/* A fixed size in the toolbar popup, and the window's viewport once popped out; every view
            fills it and scrolls its own content. */}
        <div
          className={
            isPoppedOut ? "flex h-dvh w-full flex-col" : "flex flex-col"
          }
          style={
            isPoppedOut
              ? undefined
              : { width: POPUP_WIDTH, height: POPUP_HEIGHT }
          }
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

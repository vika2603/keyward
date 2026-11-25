import { useEffect, useState } from "react"
import { callBackground, type PopupView } from "@/background/api"
import { useAppearance } from "@/components/keyward/appearance"
import { useLanguage } from "@/components/keyward/language"
import type { LoginSummary, VaultInfo } from "@/lib/providers/types"
import { AddView } from "./add-view"
import { CodeSetupView } from "./code-setup-view"
import { ConnectView } from "./connect-view"
import { DetailView } from "./detail-view"
import { EditView } from "./edit-view"
import { GeneratorView } from "./generator-view"
import { HistoryView } from "./history-view"
import { MainView } from "./main-view"

export type View =
  | PopupView
  | { name: "add" }
  | { name: "history" }
  | { name: "detail"; vault: VaultInfo; login: LoginSummary }
  | { name: "edit"; vault: VaultInfo; login: LoginSummary }

// Requested once per popup: the background hands out a pending view only to the first request.
const initialView = callBackground("popup.takeView", null).catch(
  (): PopupView => ({ name: "main" }),
)

export function App() {
  const density = useAppearance()
  const language = useLanguage()
  const [view, setView] = useState<View | null>(null)
  /** The main view's search, kept while a found login's details are open. */
  const [query, setQuery] = useState("")

  useEffect(() => {
    void initialView.then(setView)
  }, [])

  if (!language) return null
  const main = () => setView({ name: "main" })
  return (
    // A fixed size, as Chrome keeps a popup's size while it is open; every view fills it and
    // scrolls its own content.
    <div className="flex h-[600px] w-[380px] flex-col">
      {view?.name === "main" && (
        <MainView
          density={density}
          query={query}
          onQuery={setQuery}
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
  )
}

import { useEffect, useState } from "react"
import { useAppearance } from "@/components/keyward/appearance"
import { useLanguage } from "@/components/keyward/language"
import { t } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { FillPage } from "./fill-page"
import { KeysPage } from "./keys-page"
import { OnboardPage } from "./onboard-page"
import { SitesPage } from "./sites-page"
import { VaultsPage } from "./vaults-page"

const PAGES = [
  { hash: "vaults", titleKey: "options.vaults.title", Page: VaultsPage },
  { hash: "fill", titleKey: "options.fill.title", Page: FillPage },
  { hash: "sites", titleKey: "options.sites.title", Page: SitesPage },
  { hash: "keys", titleKey: "options.keys.title", Page: KeysPage },
] as const

function currentHash(): string {
  return location.hash.replace(/^#/, "")
}

export function navigate(hash: string): void {
  location.hash = hash
}

export function App() {
  const language = useLanguage()
  useAppearance()
  const [hash, setHash] = useState(currentHash)

  useEffect(() => {
    const update = () => setHash(currentHash())
    addEventListener("hashchange", update)
    return () => removeEventListener("hashchange", update)
  }, [])

  if (!language) return null
  if (hash === "onboard") return <OnboardPage />

  const page = PAGES.find((p) => p.hash === hash) ?? PAGES[0]
  return (
    <div className="flex min-h-screen flex-wrap bg-background">
      <nav
        aria-label={t("options.nav.label")}
        className="flex shrink grow basis-[220px] flex-col gap-1 border-r border-sidebar-border bg-sidebar p-2"
      >
        <div className="px-2.5 pt-1 pb-3.5 text-sm font-semibold">
          {t("options.nav.heading")}
        </div>
        {PAGES.map((p) => (
          <a
            key={p.hash}
            href={`#${p.hash}`}
            aria-current={p === page ? "page" : undefined}
            className={cn(
              "flex h-8 items-center gap-2 rounded-md p-2 text-sm hover:bg-foreground/5",
              p === page && "bg-foreground/8 font-medium hover:bg-foreground/8",
            )}
          >
            {t(p.titleKey)}
          </a>
        ))}
      </nav>
      <main className="min-w-0 shrink grow-[999] basis-[560px] px-[clamp(16px,4vw,40px)] pt-8 pb-14">
        <div className="flex max-w-[720px] flex-col gap-6">
          <page.Page />
        </div>
      </main>
    </div>
  )
}

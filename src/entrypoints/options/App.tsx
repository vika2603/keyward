import {
  GlobeIcon,
  KeyboardIcon,
  RectangleEllipsisIcon,
  VaultIcon,
} from "lucide-react"
import { useEffect, useState } from "react"
import keywardIcon from "@/assets/icon.svg"
import { useAppearance } from "@/components/keyward/appearance"
import { useLanguage } from "@/components/keyward/language"
import { t } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { FillPage } from "./fill-page"
import { KeysPage } from "./keys-page"
import { currentHash } from "./navigation"
import { OnboardPage } from "./onboard-page"
import { SitesPage } from "./sites-page"
import { VaultsPage } from "./vaults-page"

const PAGES = [
  {
    hash: "vaults",
    titleKey: "options.vaults.title",
    Icon: VaultIcon,
    Page: VaultsPage,
  },
  {
    hash: "fill",
    titleKey: "options.fill.title",
    Icon: RectangleEllipsisIcon,
    Page: FillPage,
  },
  {
    hash: "sites",
    titleKey: "options.sites.title",
    Icon: GlobeIcon,
    Page: SitesPage,
  },
  {
    hash: "keys",
    titleKey: "options.keys.title",
    Icon: KeyboardIcon,
    Page: KeysPage,
  },
] as const

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

  const page = PAGES.find((candidate) => candidate.hash === hash) ?? PAGES[0]
  return (
    <div className="flex min-h-screen flex-col bg-canvas md:flex-row">
      <nav
        aria-label={t("options.nav.label")}
        className="flex flex-col gap-2 border-b border-sidebar-border bg-sidebar p-3 md:w-60 md:shrink-0 md:border-r md:border-b-0"
      >
        <div className="flex items-center gap-2.5 px-2.5 pt-1.5 pb-2 text-sm font-semibold tracking-tight">
          <img
            src={keywardIcon}
            alt=""
            aria-hidden="true"
            draggable={false}
            className="size-6 shrink-0"
          />
          {t("options.nav.heading")}
        </div>
        <div className="flex flex-wrap gap-1 md:flex-col">
          {PAGES.map((navPage) => {
            const active = navPage === page
            return (
              <a
                key={navPage.hash}
                href={`#${navPage.hash}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-8.5 items-center gap-2.5 rounded-lg px-2.5 text-sm text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground",
                  active &&
                    "bg-foreground/8 font-medium text-foreground hover:bg-foreground/8",
                )}
              >
                <navPage.Icon className="size-4 shrink-0" aria-hidden="true" />
                {t(navPage.titleKey)}
              </a>
            )
          })}
        </div>
      </nav>
      <main className="min-w-0 flex-1 px-[clamp(16px,4vw,48px)] pt-8 pb-16">
        <div className="mx-auto flex max-w-[720px] flex-col gap-6">
          <page.Page />
        </div>
      </main>
    </div>
  )
}

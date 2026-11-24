import { useEffect, useState } from "react"
import { useAppearance } from "@/components/keyward/appearance"
import { cn } from "@/lib/utils"
import { BackendsPage } from "./backends-page"
import { FillPage } from "./fill-page"
import { KeysPage } from "./keys-page"
import { OnboardPage } from "./onboard-page"
import { SitesPage } from "./sites-page"

const PAGES = [
  { hash: "backends", title: "后端", Page: BackendsPage },
  { hash: "fill", title: "填充与保存", Page: FillPage },
  { hash: "sites", title: "站点规则", Page: SitesPage },
  { hash: "keys", title: "快捷键与外观", Page: KeysPage },
] as const

function currentHash(): string {
  return location.hash.replace(/^#/, "")
}

export function navigate(hash: string): void {
  location.hash = hash
}

export function App() {
  useAppearance()
  const [hash, setHash] = useState(currentHash)

  useEffect(() => {
    const update = () => setHash(currentHash())
    addEventListener("hashchange", update)
    return () => removeEventListener("hashchange", update)
  }, [])

  if (hash === "onboard") return <OnboardPage />

  const page = PAGES.find((p) => p.hash === hash) ?? PAGES[0]
  return (
    <div className="flex min-h-screen flex-wrap bg-background">
      <nav
        aria-label="设置分区"
        className="flex shrink grow basis-[220px] flex-col gap-1 border-r border-sidebar-border bg-sidebar p-2"
      >
        <div className="px-2.5 pt-1 pb-3.5 text-sm font-semibold">设置</div>
        {PAGES.map((p) => (
          <a
            key={p.hash}
            href={`#${p.hash}`}
            aria-current={p === page ? "page" : undefined}
            className={cn(
              "flex h-8 items-center gap-2 rounded-md p-2 text-sm hover:bg-sidebar-accent",
              p === page && "bg-sidebar-accent font-medium",
            )}
          >
            {p.title}
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

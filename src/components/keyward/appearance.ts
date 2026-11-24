import { useEffect, useState } from "react"
import { getSettings, type Settings, settingsItem } from "@/lib/settings"

type Appearance = Pick<Settings, "theme" | "density">

/** Applies the theme setting to the page and returns the list density. */
export function useAppearance(): Settings["density"] {
  const [appearance, setAppearance] = useState<Appearance>({
    theme: "system",
    density: "standard",
  })

  useEffect(() => {
    void getSettings().then(setAppearance)
    return settingsItem.watch((next) => {
      if (next) setAppearance({ theme: next.theme, density: next.density })
    })
  }, [])

  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)")
    const apply = () => {
      const dark =
        appearance.theme === "dark" ||
        (appearance.theme === "system" && media.matches)
      document.documentElement.classList.toggle("dark", dark)
    }
    apply()
    media.addEventListener("change", apply)
    return () => media.removeEventListener("change", apply)
  }, [appearance.theme])

  return appearance.density
}

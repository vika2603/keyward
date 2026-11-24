import { useEffect, useState } from "react"
import { getSettings, type Settings, settingsItem } from "@/lib/settings"
import { isDarkTheme } from "@/lib/theme"

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
      const dark = isDarkTheme(appearance.theme)
      document.documentElement.classList.toggle("dark", dark)
      // Native controls and scrollbars follow, and an overlay frame's scheme must equal the one its
      // iframe element declares, or Chrome paints an opaque backdrop behind the frame.
      document.documentElement.style.colorScheme = dark ? "dark" : "light"
    }
    apply()
    media.addEventListener("change", apply)
    return () => media.removeEventListener("change", apply)
  }, [appearance.theme])

  return appearance.density
}

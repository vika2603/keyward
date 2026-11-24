import type { Settings } from "./settings"

/** Whether the interface is dark under a theme setting, given what the current document prefers. */
export function isDarkTheme(theme: Settings["theme"]): boolean {
  return (
    theme === "dark" ||
    (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches)
  )
}

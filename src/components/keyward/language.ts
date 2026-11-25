import { useEffect, useState } from "react"
import { type Language, resolveLanguage, setLanguage } from "@/lib/i18n"
import { getSettings, settingsItem } from "@/lib/settings"

/**
 * Applies the language setting to the page and returns it once read; pages render nothing before
 * that, so text never shows in the wrong language first.
 */
export function useLanguage(): Language | null {
  const [language, setState] = useState<Language | null>(null)

  useEffect(() => {
    const apply = (setting: Parameters<typeof resolveLanguage>[0]) => {
      const next = resolveLanguage(setting)
      setLanguage(next)
      document.documentElement.lang = next
      setState(next)
    }
    void getSettings().then((settings) => apply(settings.language))
    return settingsItem.watch((next) => {
      if (next) apply(next.language ?? "system")
    })
  }, [])

  return language
}

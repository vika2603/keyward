import { useEffect, useState } from "react"
import {
  getSettings,
  type Settings,
  settingsItem,
  updateSettings,
} from "@/lib/settings"

/** The current settings, kept in sync with storage, and a function that changes some of them. */
export function useSettings(): [
  Settings | null,
  (patch: Partial<Settings>) => void,
] {
  const [settings, setSettings] = useState<Settings | null>(null)
  useEffect(() => {
    void getSettings().then(setSettings)
    return settingsItem.watch(() => void getSettings().then(setSettings))
  }, [])
  return [settings, (patch) => void updateSettings(patch).then(setSettings)]
}

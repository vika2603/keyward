import { t } from "@/lib/i18n"
import type { VaultInfo } from "@/lib/providers/types"

/**
 * What a vault that is not open yet asks the user for: a title and a line under it. A vault known
 * to keep logins for the page says so instead of how to pair.
 */
export function connectTexts(
  vault: VaultInfo & { keepsPageLogins?: boolean },
): {
  title: string
  detail: string
} {
  if (vault.needsSetup)
    return { title: t("pairing.setUp.title"), detail: t("vault.setUpDetail") }
  if (vault.kind === "apple")
    return {
      title: t("popup.main.pairApple"),
      detail: vault.keepsPageLogins
        ? t("popup.main.pairAppleHasLogins")
        : t("popup.main.pairAppleDetail"),
    }
  return { title: t("popup.main.unlockBitwarden"), detail: vault.label }
}

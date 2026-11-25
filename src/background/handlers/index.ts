import type { Handlers } from "@/lib/messaging"
import type { BackgroundApi } from "../api"
import type { Providers } from "../providers"
import { appleHandlers } from "./apple"
import { bitwardenHandlers } from "./bitwarden"
import { contentHandlers } from "./content"
import { generatorHandlers } from "./generator"
import { menuHandlers } from "./menu"
import { popupItemHandlers } from "./popup-items"
import { popupNoteHandlers } from "./popup-notes"
import { popupSaveHandlers } from "./popup-save"
import { promptHandlers } from "./prompt"

/**
 * The background's answers to requests from the popup, the options page, the in-page overlays and
 * the content scripts, one module per sender and subject.
 */
export function createHandlers(providers: Providers): Handlers<BackgroundApi> {
  return {
    ...popupItemHandlers(providers),
    ...popupNoteHandlers(providers),
    ...popupSaveHandlers(providers),
    ...appleHandlers(providers),
    ...bitwardenHandlers(providers),
    ...generatorHandlers(),
    ...menuHandlers(providers),
    ...promptHandlers(providers),
    ...contentHandlers(providers),
  }
}

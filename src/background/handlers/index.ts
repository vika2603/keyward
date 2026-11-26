import type { Handlers } from "@/lib/messaging"
import type { AppleProvider } from "@/lib/providers/apple/apple-provider"
import type { BitwardenProvider } from "@/lib/providers/bitwarden/bitwarden-provider"
import type { BackgroundApi } from "../api"
import type { HttpAuth } from "../http-auth"
import type { Providers } from "../providers"
import { appleHandlers } from "./apple"
import { bitwardenHandlers } from "./bitwarden"
import { contentHandlers } from "./content"
import { generatorHandlers } from "./generator"
import { httpAuthHandlers } from "./http-auth"
import { menuHandlers } from "./menu"
import { popupItemHandlers } from "./popup-items"
import { popupNoteHandlers } from "./popup-notes"
import { popupSaveHandlers } from "./popup-save"
import { promptHandlers } from "./prompt"
import { welcomeHandlers } from "./welcome"

/** The providers whose own requests, such as pairing or signing in, name them directly. */
export interface NamedProviders {
  apple: AppleProvider
  bitwarden: BitwardenProvider
}

/**
 * The background's answers to requests from the popup, the options page, the pages that set Keyward
 * up, the in-page overlays and the content scripts, one module per sender and subject. Only the requests of one provider reach
 * it by name; every other request goes through `providers`.
 */
export function createHandlers(
  providers: Providers,
  named: NamedProviders,
  httpAuth: HttpAuth,
): Handlers<BackgroundApi> {
  return {
    ...popupItemHandlers(providers),
    ...popupNoteHandlers(providers),
    ...popupSaveHandlers(providers),
    ...appleHandlers(named.apple),
    ...bitwardenHandlers(named.bitwarden),
    ...generatorHandlers(),
    ...menuHandlers(providers),
    ...promptHandlers(providers),
    ...contentHandlers(providers),
    ...welcomeHandlers(),
    ...httpAuthHandlers(httpAuth),
  }
}

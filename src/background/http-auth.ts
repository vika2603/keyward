import { vaultsToOffer, waitsForUser } from "@/lib/offered-vaults"
import { VaultError } from "@/lib/providers/types"
import { getSettings } from "@/lib/settings"
import type { HttpAuthView } from "./api"
import { webPage } from "./page"
import { PopupPromptGate, type PopupPromptLifecycle } from "./popup-prompt"
import type { Providers } from "./providers"

/**
 * The schemes answered with a login. NTLM and Negotiate sign in with the computer's own account
 * over several messages, which a login from a vault is not meant for.
 */
const ANSWERED_SCHEMES = new Set(["basic", "digest"])

/** What the browser reports of a request that asks for a login. */
export interface AuthChallenge {
  requestId: string
  url: string
  scheme: string
  isProxy: boolean
  challenger: { host: string; port: number }
}

/** A login for the request, or nothing, which leaves the asking to the browser's own dialog. */
export type AuthAnswer = {
  authCredentials?: { username: string; password: string }
}

interface PendingAuth {
  requestId: string
  page: URL
}

/**
 * Answers a site's request for a login through the browser's own sign-in dialog, as routers and
 * other admin pages ask, with the login the user chooses in the popup. Only a page the user opens
 * is answered, never a request the page makes by itself, and only with a login of the site's own
 * address. One request waits for the user at a time; others go to the browser's dialog.
 */
export class HttpAuth implements PopupPromptLifecycle {
  private readonly gate: PopupPromptGate<PendingAuth, AuthAnswer>
  /** The request answered last; asked again, its login was refused and the browser asks. */
  private lastAnswered: string | null = null

  constructor(
    private readonly providers: Providers,
    openChooser: () => Promise<void>,
  ) {
    this.gate = new PopupPromptGate(openChooser, {
      onShowTimeout: () => ({}),
      onTimeout: () => ({}),
      onLeave: () => ({}),
    })
  }

  async respond(challenge: AuthChallenge): Promise<AuthAnswer> {
    if (challenge.requestId === this.lastAnswered) {
      this.lastAnswered = null
      return {}
    }
    if (
      this.gate.busy ||
      challenge.isProxy ||
      !ANSWERED_SCHEMES.has(challenge.scheme.toLowerCase())
    )
      return {}
    const page = webPage(challenge.url)
    if (!page || !isChallenger(page, challenge.challenger)) return {}
    if (!(await getSettings()).httpAuth) return {}
    const offered = vaultsToOffer(await this.providers.loginsForPage(page))
    if (
      !offered.some((vault) => vault.logins.length > 0 || waitsForUser(vault))
    )
      return {}
    return this.gate.ask({ requestId: challenge.requestId, page })
  }

  /** The popup that lists the site's logins opened. */
  showing(): void {
    this.gate.showing()
  }

  /** The site that waits for a login and its logins in each vault; null once it stopped waiting. */
  async view(): Promise<HttpAuthView | null> {
    const pending = this.gate.current
    if (!pending) return null
    return {
      host: pending.page.host,
      encrypted: pending.page.protocol === "https:",
      vaults: vaultsToOffer(await this.providers.loginsForPage(pending.page)),
    }
  }

  /** Signs in with a login that the vault keeps for the waiting site. */
  async answer(vaultId: string, loginId: string): Promise<void> {
    await this.gate.answer(async (pending) => {
      const vaults = await this.providers.vaultsForPage(pending.page)
      if (!vaults.some((vault) => vault.id === vaultId))
        throw new VaultError(
          "The vault does not serve this site",
          "unknownVault",
        )
      const credential = await this.providers
        .providerOf(vaultId)
        .credential(vaultId, loginId, pending.page)
      if (!credential.password)
        throw new VaultError("The login has no password", "noPassword")
      this.lastAnswered = pending.requestId
      return {
        authCredentials: {
          username: credential.username,
          password: credential.password,
        },
      }
    })
  }

  /** Leaves the asking to the browser's own dialog. */
  decline(): void {
    this.gate.settle({})
  }

  /** The popup closed; a login being read for the site still goes to it. */
  leave(): void {
    this.gate.leave()
  }
}

/** Whether the server asking is the one at the page's address, as for any request but a proxy's. */
function isChallenger(
  page: URL,
  challenger: AuthChallenge["challenger"],
): boolean {
  const port = Number(page.port) || (page.protocol === "https:" ? 443 : 80)
  return (
    page.hostname.replace(/^\[|\]$/g, "") === challenger.host &&
    port === challenger.port
  )
}

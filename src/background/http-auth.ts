import { vaultsToOffer, waitsForUser } from "@/lib/offered-vaults"
import { VaultError } from "@/lib/providers/types"
import { getSettings } from "@/lib/settings"
import type { HttpAuthView } from "./api"
import { webPage } from "./page"
import type { Providers } from "./providers"

/**
 * The schemes answered with a login. NTLM and Negotiate sign in with the computer's own account
 * over several messages, which a login from a vault is not meant for.
 */
const ANSWERED_SCHEMES = new Set(["basic", "digest"])

/** How long a request waits for the user to choose; then the browser asks instead. */
const CHOICE_MS = 5 * 60_000
/**
 * How long the popup may take to show. The browser can accept the request to open it and show
 * nothing, as a headless one does; the request should not wait for a choice nobody can make.
 */
const SHOW_MS = 5000

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

interface Pending {
  requestId: string
  page: URL
  /** Set once the popup showed the site's logins. */
  shown: boolean
  /** Set once the user chose a login, whose password may wait for Touch ID. */
  answering: boolean
  /** Set when the popup closed while the password was read. */
  left: boolean
  settle: (answer: AuthAnswer) => void
}

/**
 * Answers a site's request for a login through the browser's own sign-in dialog, as routers and
 * other admin pages ask, with the login the user chooses in the popup. Only a page the user opens
 * is answered, never a request the page makes by itself, and only with a login of the site's own
 * address. One request waits for the user at a time; others go to the browser's dialog.
 */
export class HttpAuth {
  private pending: Pending | null = null
  /** The request answered last; asked again, its login was refused and the browser asks. */
  private lastAnswered: string | null = null

  constructor(
    private readonly providers: Providers,
    private readonly openChooser: () => Promise<void>,
  ) {}

  async respond(challenge: AuthChallenge): Promise<AuthAnswer> {
    if (challenge.requestId === this.lastAnswered) {
      this.lastAnswered = null
      return {}
    }
    if (
      this.pending ||
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
    return new Promise((resolve) => {
      const timer = setTimeout(() => pending.settle({}), CHOICE_MS)
      const pending: Pending = {
        requestId: challenge.requestId,
        page,
        shown: false,
        answering: false,
        left: false,
        settle: (answer) => {
          if (this.pending !== pending) return
          clearTimeout(timer)
          this.pending = null
          resolve(answer)
        },
      }
      this.pending = pending
      this.openChooser().then(
        () =>
          setTimeout(() => {
            if (!pending.shown) pending.settle({})
          }, SHOW_MS),
        () => pending.settle({}),
      )
    })
  }

  /** The popup that lists the site's logins opened. */
  showing(): void {
    if (this.pending) this.pending.shown = true
  }

  /** The site that waits for a login and its logins in each vault; null once it stopped waiting. */
  async view(): Promise<HttpAuthView | null> {
    const pending = this.pending
    if (!pending) return null
    return {
      host: pending.page.host,
      encrypted: pending.page.protocol === "https:",
      vaults: vaultsToOffer(await this.providers.loginsForPage(pending.page)),
    }
  }

  /** Signs in with a login that the vault keeps for the waiting site. */
  async answer(vaultId: string, loginId: string): Promise<void> {
    const pending = this.requirePending()
    const vaults = await this.providers.vaultsForPage(pending.page)
    if (!vaults.some((vault) => vault.id === vaultId))
      throw new VaultError("The vault does not serve this site", "unknownVault")
    pending.answering = true
    try {
      const credential = await this.providers
        .providerOf(vaultId)
        .credential(vaultId, loginId, pending.page)
      if (!credential.password)
        throw new VaultError("The login has no password", "noPassword")
      if (this.pending !== pending)
        throw new VaultError("The site stopped asking", "pageChanged")
      this.lastAnswered = pending.requestId
      pending.settle({
        authCredentials: {
          username: credential.username,
          password: credential.password,
        },
      })
    } finally {
      pending.answering = false
      // Settling again does nothing, so this only frees a request whose read failed.
      if (pending.left) pending.settle({})
    }
  }

  /** Leaves the asking to the browser's own dialog. */
  decline(): void {
    this.pending?.settle({})
  }

  /** The popup closed; a login being read for the site still goes to it. */
  leave(): void {
    const pending = this.pending
    if (!pending) return
    if (pending.answering) pending.left = true
    else this.decline()
  }

  private requirePending(): Pending {
    if (!this.pending)
      throw new VaultError("The site stopped asking", "pageChanged")
    return this.pending
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

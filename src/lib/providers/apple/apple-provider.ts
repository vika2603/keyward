import { parse as parseHost } from "tldts"
import { equivalentDomainsOf } from "@/lib/matching"
import { serialQueue } from "@/lib/serial-queue"
import { getSettings } from "@/lib/settings"
import { isHostName, isHostOrSubdomain } from "@/lib/site"
import {
  type CodeSetup,
  type Credential,
  type ExistingLogin,
  type FrameRef,
  type LoginDetails,
  type LoginSummary,
  type NewLogin,
  type OneTimeCode,
  VaultError,
  type VaultInfo,
  type VaultProvider,
  type VaultStatus,
} from "../types"
import { HelperApi } from "./helper-api"
import { type ApplePhase, HelperSession, needsSetup } from "./helper-session"
import { type Entry, isCodeFor, loginId, parseLoginId } from "./listing"
import { APPLE_VAULT_ID } from "./vault-id"

/** Waits between listings after a save, about four seconds in all; a new login can take a moment to show up. */
const SAVE_CHECK_DELAYS_MS = [0, 250, 500, 750, 1000, 1500]

/** How the vault shows in each phase of the connection to the helper. */
const STATUS_OF_PHASE: Record<ApplePhase, VaultStatus> = {
  disabled: "locked",
  unavailable: "unavailable",
  connecting: "locked",
  unpaired: "locked",
  awaitingCode: "locked",
  paired: "ready",
}

/** Apple Passwords, read and written through the system helper's paired session. */
export class AppleProvider implements VaultProvider {
  readonly kind = "apple" as const
  readonly api: HelperApi
  private readonly saveQueue = serialQueue()

  constructor(readonly helper = new HelperSession()) {
    this.api = new HelperApi(helper)
  }

  ownsVault(vaultId: string): boolean {
    return vaultId === APPLE_VAULT_ID
  }

  async vaults(): Promise<VaultInfo[]> {
    if (!this.helper.enabled) return []
    const state = this.helper.getState()
    const { phase, error } = state
    return [
      {
        id: APPLE_VAULT_ID,
        kind: "apple",
        label: "Passwords",
        status: STATUS_OF_PHASE[phase],
        error,
        awaitingUser: phase === "awaitingCode",
        needsSetup: needsSetup(state),
      },
    ]
  }

  /**
   * The page's logins, each marked when it has a one-time code. The helper lists codes apart from
   * logins; a code listing that fails leaves the logins unmarked.
   */
  async logins(_vaultId: string, page: URL): Promise<LoginSummary[]> {
    const [entries, codes] = await Promise.all([
      this.listForPage(page.hostname),
      this.api.codeEntries(page, []).catch(() => []),
    ])
    return entries.map((entry) => ({
      id: loginId(entry.username, entry.site),
      username: entry.username,
      title: entry.customTitle || entry.site,
      host: entry.site,
      hasCode: codes.some((code) =>
        isCodeFor(code, entry.username, entry.site),
      ),
    }))
  }

  /** Before pairing, whether Passwords keeps logins for the page, by the helper's own matching. */
  async keepsLoginsFor(_vaultId: string, page: URL): Promise<boolean> {
    const { phase } = this.helper.getState()
    if (phase !== "unpaired" && phase !== "awaitingCode") return false
    return this.api.keepsLogins(page.hostname)
  }

  /** The helper looks logins up by site only, so a search must be a site's address. */
  async search(vaultId: string, query: string): Promise<LoginSummary[]> {
    const host = query.trim().toLowerCase()
    if (!host.includes(".") || !isHostName(host)) return []
    return this.logins(vaultId, new URL(`https://${host}`))
  }

  /**
   * Logins the helper lists for a page's host and for each site equivalent to it. The helper
   * matches sites itself, so an equivalent site takes a listing of its own, in which only logins
   * saved for that site or under it count: Apple's list may name a subdomain, such as
   * shop.univision.com, for it alone, while the helper may match its parent domain too.
   */
  private async listForPage(host: string): Promise<Entry[]> {
    const { equivalentDomains } = await getSettings()
    const hosts = [host, ...equivalentDomainsOf(host, equivalentDomains)]
    const listings = await Promise.all(
      hosts.map(async (listedHost) => ({
        listedHost,
        logins: (await this.api.listLogins(listedHost)).logins,
      })),
    )
    const entries: Entry[] = []
    for (const { listedHost, logins } of listings) {
      for (const entry of logins) {
        const savedForListedSite =
          listedHost === host ||
          entry.sites.some((site) => isHostOrSubdomain(site, listedHost))
        const listedBefore = entries.some(
          (seen) =>
            seen.username === entry.username && seen.site === entry.site,
        )
        if (savedForListedSite && !listedBefore) entries.push(entry)
      }
    }
    return entries
  }

  /** The login the helper lists for `host` under this username and site, if any. */
  private async listedLogin(
    host: string,
    username: string,
    site: string,
  ): Promise<Entry | undefined> {
    return (await this.listForPage(host)).find(
      (entry) => entry.username === username && entry.site === site,
    )
  }

  /**
   * Whether the user chose in the Passwords app never to save passwords for the page's site. Its
   * logins are still listed and filled; only the offer to save a new one is left out.
   */
  async refusesSaving(_vaultId: string, page: URL): Promise<boolean> {
    return (await this.api.listLogins(page.hostname)).neverSaved
  }

  /** Reads one password; macOS asks for Touch ID first. */
  async credential(
    _vaultId: string,
    id: string,
    page: URL | null,
  ): Promise<Credential> {
    const { username, site } = siteLoginOf(id)
    // The helper's own listing for the page, and for its equivalent sites, decides which logins
    // belong to it.
    if (!(await this.listedLogin(page?.hostname ?? site, username, site)))
      throw new VaultError("The login does not match this page", "notFound")
    const password = await this.api.password(site, username)
    if (password === null)
      throw new VaultError(
        "Apple Passwords has no password for this login",
        "noPassword",
      )
    return { username, password }
  }

  async details(
    _vaultId: string,
    id: string,
    page: URL | null,
  ): Promise<LoginDetails> {
    const { username, site } = siteLoginOf(id)
    const target = page ?? new URL(`https://${site}`)
    const entry = await this.listedLogin(target.hostname, username, site)
    if (!entry)
      throw new VaultError("The login does not match this page", "notFound")
    const codes = await this.api.codeEntries(target, []).catch(() => [])
    return {
      username,
      name: entry.customTitle,
      uris: entry.sites,
      hasCode: codes.some((code) => isCodeFor(code, username, site)),
      secretsWithheld: false,
      // The helper has no command to change or delete a login; the Passwords app does that.
      editable: false,
    }
  }

  async codeLogins(
    _vaultId: string,
    page: URL,
    frame: FrameRef,
  ): Promise<LoginSummary[]> {
    const entries = await this.api.codeEntries(
      page,
      await enclosingFrameURLs(frame),
    )
    return entries.map((entry) => ({
      id: loginId(entry.username, entry.domain),
      username: entry.username,
      title: entry.domain,
      host: entry.domain,
      hasCode: true,
    }))
  }

  /**
   * Reads the current code of an authenticator entry the helper offers for the page; macOS may ask
   * for Touch ID first.
   */
  async oneTimeCode(
    _vaultId: string,
    id: string,
    requested: URL | null,
    frame?: FrameRef,
  ): Promise<OneTimeCode> {
    const { username, site } = parseLoginId(id)
    if (!requested && !isHostName(site))
      throw new VaultError("The login has no site", "unknownLogin")
    const page = requested ?? new URL(`https://${site}`)
    const enclosingFrames = await enclosingFrameURLs(frame)
    const entries = await this.api.codeEntries(page, enclosingFrames)
    // The menu's IDs name the entry's own domain; the popup's name the login's site, which an
    // entry for a subdomain or parent domain may serve.
    const entry =
      entries.find(
        (candidate) =>
          candidate.username === username && candidate.domain === site,
      ) ?? entries.find((candidate) => isCodeFor(candidate, username, site))
    if (!entry) throw new VaultError("The login has no one-time code", "noCode")
    return { code: await this.api.currentCode(page, enclosingFrames, entry) }
  }

  /**
   * Apple Passwords acknowledges logins for hosts under suffixes such as `.localhost`, `.local` or
   * `.example` but never stores them. IP addresses are let through: whether they are stored is not
   * known, and the listing check after a save reports a login that was not stored.
   */
  canSave(url: URL): boolean {
    if (!isHostName(url.hostname)) return false
    const parsed = parseHost(url.hostname)
    return parsed.isIp === true || parsed.isIcann === true
  }

  /**
   * Offers a login to Apple Passwords. macOS shows its own confirmation; the helper answers once
   * the user has chosen, and the answer does not say what was chosen, so the result is checked by
   * listing. Without a user name macOS asks for one, so only a new entry shows the login was
   * stored; an update of an existing login cannot be told from a cancelled save. Logins it cannot
   * store are refused before the confirmation is shown.
   */
  save(_vaultId: string, login: NewLogin): Promise<void> {
    const host = login.url.hostname
    const username = login.username.trim()
    if (!isHostName(host))
      return Promise.reject(new VaultError("Not a host name", "invalidSite"))
    if (!this.canSave(login.url)) {
      return Promise.reject(
        new VaultError(
          "Apple Passwords does not store logins for this host",
          "apple.unsupportedSite",
        ),
      )
    }
    // The helper drops a save without a password before asking on the Mac, and answers nothing
    // that says so; refusing it here gives the reason.
    if (!login.password) {
      return Promise.reject(
        new VaultError(
          "Apple Passwords needs a password",
          "apple.emptyPassword",
        ),
      )
    }
    if (
      !username &&
      !this.helper.capabilities?.canSaveAccountWithEmptyUserName
    ) {
      return Promise.reject(
        new VaultError(
          "Apple Passwords needs a username",
          "apple.emptyUsername",
        ),
      )
    }
    return this.saveQueue(async () => {
      const entryKey = (entry: Entry) => loginId(entry.username, entry.site)
      const listedLogins = async () => (await this.api.listLogins(host)).logins
      const entriesBefore = username
        ? new Set<string>()
        : new Set((await listedLogins()).map(entryKey))
      await this.api.offerLogin(host, username, login.password)
      for (const delay of SAVE_CHECK_DELAYS_MS) {
        await new Promise((resolve) => setTimeout(resolve, delay))
        const saved = await listedLogins()
        const stored = saved.some((entry) =>
          username
            ? entry.username === username
            : !entriesBefore.has(entryKey(entry)),
        )
        if (stored) return
      }
      if (!username) {
        throw new VaultError(
          "Whether Apple Passwords stored the login cannot be told",
          "apple.saveUnconfirmed",
        )
      }
      throw new VaultError(
        "Apple Passwords did not store the login",
        "apple.notSaved",
      )
    })
  }

  update(vaultId: string, _loginId: string, login: NewLogin): Promise<void> {
    return this.save(vaultId, login)
  }

  async findExisting(
    _vaultId: string,
    page: URL,
    username: string,
  ): Promise<ExistingLogin | null> {
    const { logins } = await this.api.listLogins(page.hostname)
    const entry = logins.find((candidate) => candidate.username === username)
    return entry
      ? {
          loginId: loginId(entry.username, entry.site),
          samePassword: undefined,
        }
      : null
  }

  /** Ends the session and the helper process, so pairing again shows a new code. */
  async lock(): Promise<void> {
    this.helper.lock()
  }

  async lockAll(): Promise<void> {
    await this.lock()
  }

  /** Opens the Passwords app, searching for a site when one is given. */
  openPasswordsApp(site?: string): Promise<void> {
    return this.api.openApp(site)
  }

  /** Opens the Passwords app's form for a new password, with the site filled in. */
  openNewPasswordSheet(site: string): Promise<void> {
    return this.api.openNewPasswordSheet(site)
  }

  /**
   * The Passwords app asks on the Mac which login gets a key. Before pairing the vault is offered
   * for every site it stores logins for, since pairing comes first.
   */
  codeSetup(_vaultId: string, page: URL): CodeSetup | null {
    if (!this.canSave(page)) return null
    if (!this.helper.paired) return "app"
    return this.helper.capabilities?.scanForOTPURI ? "app" : null
  }

  /** Hands an `otpauth://` URI to the Passwords app, which asks which login of the site gets it. */
  async setUpCode(
    _vaultId: string,
    _loginId: string | null,
    page: URL,
    uri: string,
  ): Promise<void> {
    if (!this.canSave(page)) {
      throw new VaultError(
        "Apple Passwords does not store logins for this host",
        "apple.unsupportedSite",
      )
    }
    await this.api.setUpCode(page.hostname, uri)
  }
}

/** A login's username and site from its ID; a login read from the helper always has a site. */
function siteLoginOf(id: string): { username: string; site: string } {
  const login = parseLoginId(id)
  if (!isHostName(login.site))
    throw new VaultError("The login has no site", "unknownLogin")
  return login
}

/**
 * The URLs of the frames around a frame, innermost first, which the helper takes after the frame's
 * own URL when it lists one-time codes. A top frame has none, and so does a request from the popup,
 * which names no frame; without the tab's frame tree none are known.
 */
async function enclosingFrameURLs(frame?: FrameRef): Promise<string[]> {
  if (!frame || frame.frameId === 0) return []
  const frames = await browser.webNavigation
    .getAllFrames({ tabId: frame.tabId })
    .catch(() => null)
  const byId = new Map((frames ?? []).map((each) => [each.frameId, each]))
  const urls: string[] = []
  let parent = byId.get(frame.frameId)?.parentFrameId ?? -1
  while (parent >= 0 && urls.length < byId.size) {
    const enclosing = byId.get(parent)
    if (!enclosing) break
    urls.push(enclosing.url)
    parent = enclosing.parentFrameId
  }
  return urls
}

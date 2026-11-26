import { parse as parseHost } from "tldts"
import { equivalentDomainsOf } from "@/lib/matching"
import { serialQueue } from "@/lib/serial-queue"
import { getSettings } from "@/lib/settings"
import { isHostName, isHostOrSubdomain } from "@/lib/site"
import {
  type CodeSetup,
  type Credential,
  type ExistingLogin,
  type LoginDetails,
  type LoginSummary,
  type NewLogin,
  type OneTimeCode,
  type TabRef,
  VaultError,
  type VaultInfo,
  type VaultProvider,
  type VaultStatus,
} from "../types"
import { type ApplePhase, HelperSession, needsSetup } from "./helper-session"
import {
  type CodeEntry,
  codeEntryOf,
  type Entry,
  entryOf,
  isCodeFor,
  loginId,
  parseLoginId,
  passwordIn,
  TOTP_SOURCE,
} from "./listing"
import {
  Action,
  Cmd,
  entriesOf,
  isLoginEntry,
  isNeverSavedEntry,
  QueryStatus,
} from "./protocol"
import { APPLE_VAULT_ID } from "./vault-id"

const LIST_TIMEOUT_MS = 15_000
const SAVE_TIMEOUT_MS = 10 * 60_000
/** Waits between listings after a save, about four seconds in all; a new login can take a moment to show up. */
const SAVE_CHECK_DELAYS_MS = [0, 250, 500, 750, 1000, 1500]
/** Saves use frame IDs from here up, so their replies (sent as command 4) never reach a login listing. */
const SAVE_FRAME_BASE = 1_000_000_000
/** The tab of a lookup the background makes on its own; the helper uses the tab only to route its reply. */
const BACKGROUND_TAB: TabRef = { tabId: 0, frameId: 0 }

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
  private readonly listQueue = serialQueue()
  private readonly codeQueue = serialQueue()
  private readonly saveQueue = serialQueue()
  private saveCount = 0

  constructor(readonly helper = new HelperSession()) {}

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
        label: "Apple Passwords",
        status: STATUS_OF_PHASE[phase],
        error,
        awaitingUser: phase === "awaitingCode",
        needsSetup: needsSetup(state),
      },
    ]
  }

  async logins(_vaultId: string, page: URL): Promise<LoginSummary[]> {
    const entries = await this.listForPage(page.hostname)
    return entries.map((entry) => ({
      id: loginId(entry.username, entry.site),
      username: entry.username,
      title: entry.customTitle || entry.site,
      host: entry.site,
    }))
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
    const entries: Entry[] = []
    for (const listedHost of hosts) {
      for (const entry of await this.listEntries(listedHost, BACKGROUND_TAB)) {
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
    const entries = await this.listedEntries(page.hostname, BACKGROUND_TAB)
    return entries.some(isNeverSavedEntry)
  }

  private async listEntries(host: string, tab: TabRef): Promise<Entry[]> {
    const entries = await this.listedEntries(host, tab)
    return entries.filter(isLoginEntry).map((entry) => entryOf(entry, host))
  }

  /** Every entry the helper lists for a host, including the mark of a site never saved. */
  private async listedEntries(
    host: string,
    tab: TabRef,
  ): Promise<Record<string, unknown>[]> {
    // The helper has crashed on a request with an empty URL, which also ends the session.
    if (!isHostName(host)) return []
    const reply = await this.listQueue(() =>
      this.helper.query(
        {
          cmd: Cmd.GetLoginNamesForUrl,
          url: host,
          tabId: tab.tabId,
          frameId: tab.frameId,
        },
        "CmdGetLoginNames4URL",
        { ACT: Action.GhostSearch, URL: host },
        { timeoutMs: LIST_TIMEOUT_MS, matchTab: true },
      ),
    )
    if (reply.STATUS === QueryStatus.NoResults) return []
    return entriesOf(reply)
  }

  /**
   * Reads one password. macOS asks for Touch ID first; with the prompt dismissed the helper never
   * answers, so this waits without a timeout and a newer read replaces it.
   */
  async credential(
    _vaultId: string,
    id: string,
    page: URL | null,
    tab: TabRef,
  ): Promise<Credential> {
    const { username, site } = siteLoginOf(id)
    // The helper's own listing for the page, and for its equivalent sites, decides which logins
    // belong to it.
    if (!(await this.listedLogin(page?.hostname ?? site, username, site)))
      throw new VaultError("The login does not match this page", "notFound")
    const reply = await this.helper.query(
      {
        cmd: Cmd.GetPasswordForLoginName,
        url: site,
        tabId: tab.tabId,
        frameId: tab.frameId,
      },
      "CmdGetPassword4LoginName",
      { ACT: Action.Search, URL: site, USR: username },
      { timeoutMs: null },
    )
    const password = passwordIn(reply, username, site)
    if (password) return { username, password }
    if (password === null)
      throw new VaultError(
        "Apple Passwords has no password for this login",
        "noPassword",
      )
    throw new VaultError("Apple Passwords returned no password", "notFound")
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
    const codes = await this.codeEntries(target, BACKGROUND_TAB).catch(() => [])
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

  /** Authenticator entries for a page, when the helper can give codes. */
  private async codeEntries(page: URL, tab: TabRef): Promise<CodeEntry[]> {
    await this.helper.ensureConnected()
    if (
      !this.helper.capabilities?.canFillOneTimeCodes ||
      !isHostName(page.hostname)
    )
      return []
    const frameURLs = await frameChain(page, tab)
    const reply = await this.codeQueue(() =>
      this.helper.query(
        { cmd: Cmd.GetOneTimeCodes, tabId: tab.tabId, frameId: tab.frameId },
        "CmdGetOneTimeCodes",
        { ACT: Action.GhostSearch, TYPE: "oneTimeCodes", frameURLs },
        { timeoutMs: LIST_TIMEOUT_MS },
      ),
    )
    if (reply.STATUS === QueryStatus.NoResults) return []
    return entriesOf(reply)
      .filter((entry) => entry.source === TOTP_SOURCE)
      .map((entry) => codeEntryOf(entry, page.hostname))
  }

  async codeLogins(
    _vaultId: string,
    page: URL,
    tab: TabRef,
  ): Promise<LoginSummary[]> {
    return (await this.codeEntries(page, tab)).map((entry) => ({
      id: loginId(entry.username, entry.domain),
      username: entry.username,
      title: entry.domain,
      host: entry.domain,
      hasCode: true,
    }))
  }

  /**
   * Reads the current code of an authenticator entry the helper offers for the page. macOS may ask
   * for Touch ID first, so this waits without a timeout and a newer read replaces it.
   */
  async oneTimeCode(
    _vaultId: string,
    id: string,
    requested: URL | null,
    tab: TabRef,
  ): Promise<OneTimeCode> {
    const { username, site } = parseLoginId(id)
    if (!requested && !isHostName(site))
      throw new VaultError("The login has no site", "unknownLogin")
    const page = requested ?? new URL(`https://${site}`)
    const entries = await this.codeEntries(page, tab)
    // The menu's IDs name the entry's own domain; the popup's name the login's site, which an
    // entry for a subdomain or parent domain may serve.
    const entry =
      entries.find(
        (candidate) =>
          candidate.username === username && candidate.domain === site,
      ) ?? entries.find((candidate) => isCodeFor(candidate, username, site))
    if (!entry) throw new VaultError("The login has no one-time code", "noCode")
    const reply = await this.helper.query(
      { cmd: Cmd.DidFillOneTimeCode, tabId: tab.tabId, frameId: tab.frameId },
      "CmdDidFillOneTimeCode",
      {
        ACT: Action.Search,
        TYPE: "oneTimeCodes",
        frameURLs: await frameChain(page, tab),
        ...(entry.username ? { username: entry.username } : {}),
      },
      { timeoutMs: null },
    )
    const match = entriesOf(reply).find((candidate) => {
      const listed = codeEntryOf(candidate, page.hostname)
      return (
        candidate.source === TOTP_SOURCE &&
        listed.username === entry.username &&
        listed.domain === entry.domain
      )
    })
    const code = match?.code
    if (typeof code !== "string" && typeof code !== "number")
      throw new VaultError("Apple Passwords returned no code", "noCode")
    return { code: String(code) }
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
  save(_vaultId: string, login: NewLogin, tab: TabRef): Promise<void> {
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
    // Apple's own extension offers only passwords typed into a page, never an empty one.
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
      const entriesBefore = username
        ? new Set<string>()
        : new Set((await this.listEntries(host, tab)).map(entryKey))
      this.saveCount += 1
      const frameId = SAVE_FRAME_BASE + this.saveCount
      await this.helper.query(
        { cmd: Cmd.SetPasswordForLoginNameAndUrl, tabId: tab.tabId, frameId },
        "CmdSetPassword4LoginName_URL",
        {
          ACT: Action.MaybeAdd,
          URL: "",
          USR: "",
          PWD: "",
          NURL: host,
          NUSR: username,
          NPWD: login.password,
        },
        {
          timeoutMs: SAVE_TIMEOUT_MS,
          replyCmd: Cmd.GetLoginNamesForUrl,
          matchTab: true,
        },
      )
      for (const delay of SAVE_CHECK_DELAYS_MS) {
        await new Promise((resolve) => setTimeout(resolve, delay))
        const saved = await this.listEntries(host, tab)
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

  update(
    vaultId: string,
    _loginId: string,
    login: NewLogin,
    tab: TabRef,
  ): Promise<void> {
    return this.save(vaultId, login, tab)
  }

  async findExisting(
    _vaultId: string,
    page: URL,
    username: string,
  ): Promise<ExistingLogin | null> {
    const entries = await this.listEntries(page.hostname, BACKGROUND_TAB)
    const entry = entries.find((candidate) => candidate.username === username)
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
  async openPasswordsApp(site?: string): Promise<void> {
    await this.helper.ensureConnected()
    this.helper.post(
      site && isHostName(site)
        ? { cmd: Cmd.LaunchPasswordsApp, searchQueryURL: `https://${site}` }
        : { cmd: Cmd.LaunchPasswordsApp },
    )
  }

  /** Opens the Passwords app's form for a new password, with the site filled in. */
  async openNewPasswordSheet(site: string): Promise<void> {
    await this.helper.ensureConnected()
    if (!this.helper.capabilities?.canOpenPasswordsAppToNewPasswordSheet) {
      throw new VaultError(
        "This Passwords app cannot open its new password form",
        "apple.unsupported",
      )
    }
    if (!isHostName(site))
      throw new VaultError("Not a web address", "invalidSite")
    this.helper.post({
      cmd: Cmd.LaunchPasswordsApp,
      newPasswordWithSuggestedURL: `https://${site}`,
    })
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
    if (!this.helper.paired || !this.helper.capabilities?.scanForOTPURI)
      throw new VaultError("Apple Passwords cannot set up codes now", "locked")
    this.helper.post({
      cmd: Cmd.LaunchPasswordsApp,
      setUpTOTPPageURL: page.hostname,
      setUpTOTPURI: uri,
    })
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
 * The URL of the frame a request is for, followed by those of the frames that contain it, as the
 * helper expects for one-time codes. Without the frame tree only the frame's own URL is sent.
 */
async function frameChain(page: URL, tab: TabRef): Promise<string[]> {
  const urls = [page.href]
  if (tab.frameId === 0) return urls
  const frames = await browser.webNavigation
    .getAllFrames({ tabId: tab.tabId })
    .catch(() => null)
  const byId = new Map((frames ?? []).map((frame) => [frame.frameId, frame]))
  let parent = byId.get(tab.frameId)?.parentFrameId ?? -1
  while (parent >= 0 && urls.length <= byId.size) {
    const frame = byId.get(parent)
    if (!frame) break
    urls.push(frame.url)
    parent = frame.parentFrameId
  }
  return urls
}

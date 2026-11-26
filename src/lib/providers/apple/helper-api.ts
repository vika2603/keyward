import { serialQueue } from "@/lib/serial-queue"
import { isHostName } from "@/lib/site"
import { VaultError } from "../types"
import type { HelperSession } from "./helper-session"
import {
  type CodeEntry,
  codeEntryOf,
  type Entry,
  entryOf,
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

const LIST_TIMEOUT_MS = 15_000
/** A save waits for the user to answer macOS's confirmation. */
const SAVE_TIMEOUT_MS = 10 * 60_000

/** The parts of the session the commands run in. */
export type HelperApiSession = Pick<
  HelperSession,
  "query" | "post" | "ensureConnected" | "capabilities" | "paired"
>

/** What the helper lists for a host. */
export interface SiteListing {
  logins: Entry[]
  /** Whether the user chose in the Passwords app never to save passwords for the site. */
  neverSaved: boolean
}

/**
 * The commands of Apple's Passwords helper, one method each. Connecting and pairing belong to
 * `HelperSession`, which the queries run in; which logins belong to a page is `AppleProvider`'s.
 */
export class HelperApi {
  /**
   * Apple's extension does not rely on the helper echoing the frame ID of a code listing, so code
   * listings go one at a time.
   */
  private readonly codeListings = serialQueue()

  constructor(private readonly session: HelperApiSession) {}

  /** Command 4: the logins saved for a host, and whether the site is set never to save. */
  async listLogins(host: string): Promise<SiteListing> {
    // The helper has crashed on a request with an empty URL, which also ends the session.
    if (!isHostName(host)) return { logins: [], neverSaved: false }
    const reply = await this.session.query(
      { cmd: Cmd.GetLoginNamesForUrl, url: host },
      { ACT: Action.GhostSearch, URL: host },
      { timeoutMs: LIST_TIMEOUT_MS },
    )
    const entries = listedEntries(reply)
    return {
      logins: entries.filter(isLoginEntry).map((entry) => entryOf(entry, host)),
      neverSaved: entries.some(isNeverSavedEntry),
    }
  }

  /**
   * Command 5: a login's password, or null when it has none, as a login with only a passkey. macOS
   * asks for Touch ID first; with the prompt dismissed the helper never answers, so this waits
   * without a timeout and a newer read replaces it.
   */
  async password(site: string, username: string): Promise<string | null> {
    const reply = await this.session.query(
      { cmd: Cmd.GetPasswordForLoginName, url: site },
      { ACT: Action.Search, URL: site, USR: username },
      { timeoutMs: null, newestOnly: true },
    )
    const password = passwordIn(reply, username, site)
    if (password === undefined)
      throw new VaultError("Apple Passwords returned no password", "notFound")
    return password
  }

  /**
   * Command 6: offers a login for Apple Passwords to add, or to update the password of. macOS asks
   * the user, and for a username when none is given. The helper answers once the user has chosen,
   * and the answer does not say what was chosen.
   */
  async offerLogin(
    host: string,
    username: string,
    password: string,
  ): Promise<void> {
    await this.session.query(
      { cmd: Cmd.SetPasswordForLoginNameAndUrl },
      {
        ACT: Action.MaybeAdd,
        URL: "",
        USR: "",
        PWD: "",
        NURL: host,
        NUSR: username,
        NPWD: password,
      },
      // The helper answers a save as it answers a listing.
      { timeoutMs: SAVE_TIMEOUT_MS, replyCmd: Cmd.GetLoginNamesForUrl },
    )
  }

  /**
   * Command 16: the authenticator entries the helper offers codes for in a frame. `page` is the
   * frame's URL and `enclosingFrames` the URLs of the frames around it, innermost first. Codes from
   * messages never reach the helper, so only entries with an authenticator key count.
   */
  async codeEntries(
    page: URL,
    enclosingFrames: string[],
  ): Promise<CodeEntry[]> {
    await this.session.ensureConnected()
    const canList =
      this.session.capabilities?.canFillOneTimeCodes &&
      isHostName(page.hostname)
    if (!canList) return []
    const reply = await this.codeListings(() =>
      this.session.query(
        { cmd: Cmd.GetOneTimeCodes },
        {
          ACT: Action.GhostSearch,
          TYPE: "oneTimeCodes",
          frameURLs: [page.href, ...enclosingFrames],
        },
        { timeoutMs: LIST_TIMEOUT_MS },
      ),
    )
    return listedEntries(reply)
      .filter((entry) => entry.source === TOTP_SOURCE)
      .map((entry) => codeEntryOf(entry, page.hostname))
  }

  /**
   * Command 17: the current code of an authenticator entry `codeEntries` listed for the frame.
   * macOS asks for Touch ID first, so this waits without a timeout and a newer read replaces it.
   */
  async currentCode(
    page: URL,
    enclosingFrames: string[],
    entry: CodeEntry,
  ): Promise<string> {
    const reply = await this.session.query(
      { cmd: Cmd.DidFillOneTimeCode },
      {
        ACT: Action.Search,
        TYPE: "oneTimeCodes",
        frameURLs: [page.href, ...enclosingFrames],
        ...(entry.username ? { username: entry.username } : {}),
      },
      { timeoutMs: null, newestOnly: true },
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
    return String(code)
  }

  /** Command 13: opens the Passwords app, searching for a site when one is given. */
  async openApp(site?: string): Promise<void> {
    await this.session.ensureConnected()
    this.session.post(
      site && isHostName(site)
        ? { cmd: Cmd.LaunchPasswordsApp, searchQueryURL: `https://${site}` }
        : { cmd: Cmd.LaunchPasswordsApp },
    )
  }

  /** Command 13: opens the Passwords app's form for a new password, with the site filled in. */
  async openNewPasswordSheet(site: string): Promise<void> {
    await this.session.ensureConnected()
    if (!this.session.capabilities?.canOpenPasswordsAppToNewPasswordSheet) {
      throw new VaultError(
        "This Passwords app cannot open its new password form",
        "apple.unsupported",
      )
    }
    if (!isHostName(site))
      throw new VaultError("Not a web address", "invalidSite")
    this.session.post({
      cmd: Cmd.LaunchPasswordsApp,
      newPasswordWithSuggestedURL: `https://${site}`,
    })
  }

  /**
   * Command 13: hands an `otpauth://` URI found on a page to the Passwords app, which asks on the
   * Mac which login of the site gets it.
   */
  async setUpCode(host: string, uri: string): Promise<void> {
    if (!this.session.paired || !this.session.capabilities?.scanForOTPURI)
      throw new VaultError("Apple Passwords cannot set up codes now", "locked")
    this.session.post({
      cmd: Cmd.LaunchPasswordsApp,
      setUpTOTPPageURL: host,
      setUpTOTPURI: uri,
    })
  }
}

/** The entries of a listing reply; one with no results has none. */
function listedEntries(
  reply: Record<string, unknown>,
): Record<string, unknown>[] {
  return reply.STATUS === QueryStatus.NoResults ? [] : entriesOf(reply)
}

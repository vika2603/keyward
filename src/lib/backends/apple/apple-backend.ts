import { parse as parseHost } from "tldts"
import { bigIntToBytes, bytesToBigInt } from "@/lib/bytes"
import { isHostOrSubdomain } from "@/lib/site"
import {
  BackendError,
  type Credential,
  type ExistingLogin,
  type LoginDetails,
  type LoginSummary,
  type NewLogin,
  type OneTimeCode,
  type PasswordBackend,
  type SourceInfo,
  type TabRef,
} from "../types"
import { type HelperMessage, HelperPort, SupersededError } from "./helper-port"
import {
  Action,
  Cmd,
  decodePake,
  encodePake,
  entriesOf,
  type HelperCapabilities,
  isLoginEntry,
  QueryStatus,
  SecureSession,
} from "./protocol"
import { APPLE_SOURCE_ID } from "./source-id"
import { BinaryCodec, SrpClient, sameSessionId, verifyServerProof } from "./srp"

export type ApplePhase =
  | "disabled"
  /** The helper cannot be reached: not macOS, wrong extension ID, or the browser may not launch it. */
  | "unavailable"
  | "connecting"
  /** Connected to the helper without a session. */
  | "unpaired"
  /** The helper shows a code on the Mac and waits for it. */
  | "awaitingCode"
  | "paired"

export interface AppleState {
  phase: ApplePhase
  error?: string
}

const BROWSER_NAME = "Chrome"
const PROTOCOL_VERSION = "1.0"
const SRP_WITH_RFC_VERIFICATION = 1
const LIST_TIMEOUT_MS = 15_000
const SAVE_TIMEOUT_MS = 10 * 60_000
/** Waits between listings after a save, about four seconds in all; a new login can take a moment to show up. */
const SAVE_CHECK_DELAYS_MS = [0, 250, 500, 750, 1000, 1500]
/** Saves use frame IDs from here up, so their replies (sent as command 4) never reach a login listing. */
const SAVE_FRAME_BASE = 1_000_000_000

/** Whether a site the helper returned may answer a request made for `host`. */
export function isSameSite(site: string, host: string): boolean {
  return isHostOrSubdomain(site, host) || isHostOrSubdomain(host, site)
}

function loginId(username: string, site: string): string {
  return JSON.stringify([username, site])
}

function parseLoginId(id: string): { username: string; site: string } {
  const parsed: unknown = JSON.parse(id)
  if (
    !Array.isArray(parsed) ||
    typeof parsed[0] !== "string" ||
    typeof parsed[1] !== "string"
  ) {
    throw new BackendError("Unknown login", "unknownLogin")
  }
  return { username: parsed[0], site: parsed[1] }
}

function isHostName(host: string): boolean {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*$/i.test(host)
}

/** A listed login. */
interface Entry {
  username: string
  /** The site the login is listed under. */
  site: string
  /** Every site the login is saved for. */
  sites: string[]
  customTitle?: string
}

/** An authenticator entry the helper offers codes for. */
interface CodeEntry {
  username: string
  domain: string
}

const TOTP_SOURCE = "totp"

/**
 * What a reply to a password read says about one login: its password, `null` when the helper has
 * none for it, as for a login with only a passkey, or `undefined` when the reply is about other
 * logins, as a late answer to a replaced read is.
 */
export function passwordIn(
  reply: Record<string, unknown>,
  username: string,
  site: string,
): string | null | undefined {
  const entries = entriesOf(reply)
  const match = entries.find(
    (entry) =>
      (entry.USR ?? "") === username &&
      Array.isArray(entry.sites) &&
      entry.sites.some((s) => isSameSite(String(s), site)),
  )
  if (typeof match?.PWD === "string" && match.PWD) return match.PWD
  return match || !entries.length ? null : undefined
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : ""
}

/**
 * Apple Passwords through the system's PasswordManagerBrowserExtensionHelper. A paired session
 * belongs to one helper process, so it lives only in memory and lasts while the native port stays
 * open; the open port in turn keeps the service worker alive. A new browser session pairs again.
 */
export class AppleBackend implements PasswordBackend {
  readonly kind = "apple" as const
  private readonly port: HelperPort
  private capabilities: HelperCapabilities | null = null
  private session: SecureSession | null = null
  private pairing: {
    client: SrpClient
    salt: Uint8Array
    serverPublicKey: bigint
  } | null = null
  private state: AppleState = { phase: "disabled" }
  private connecting: Promise<void> | null = null
  private readonly lanes = new Map<string, Promise<unknown>>()
  private saveCount = 0
  private readonly listeners = new Set<(state: AppleState) => void>()

  constructor() {
    this.port = new HelperPort({
      onUnsolicited: (message) => this.onUnsolicited(message),
      onDisconnect: (reason) => {
        this.session = null
        this.pairing = null
        this.capabilities = null
        if (this.state.phase !== "disabled")
          this.setState({ phase: "unavailable", error: reason })
      },
    })
  }

  onChange(listener: (state: AppleState) => void): void {
    this.listeners.add(listener)
  }

  getState(): AppleState {
    return this.state
  }

  get enabled(): boolean {
    return this.state.phase !== "disabled"
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (!enabled) {
      this.port.disconnect()
      this.session = null
      this.pairing = null
      this.capabilities = null
      this.setState({ phase: "disabled" })
      return
    }
    if (this.state.phase === "disabled") this.setState({ phase: "connecting" })
    await this.ensureConnected().catch(() => {})
  }

  ensureConnected(): Promise<void> {
    if (!this.enabled)
      return Promise.reject(
        new BackendError("Apple Passwords is turned off", "apple.disabled"),
      )
    if (this.port.connected && this.capabilities) return Promise.resolve()
    this.connecting ??= this.connect().finally(() => {
      this.connecting = null
    })
    return this.connecting
  }

  private async connect(): Promise<void> {
    this.setState({ phase: "connecting" })
    try {
      this.port.connect()
      const hello = await this.port.request(
        { cmd: Cmd.Hello },
        { timeoutMs: 5000 },
      )
      this.capabilities =
        (hello.capabilities as HelperCapabilities | undefined) ?? {}
    } catch (error) {
      this.port.disconnect()
      this.capabilities = null
      this.setState({ phase: "unavailable", error: errorText(error) })
      throw new BackendError(
        "The Apple Passwords helper is not available",
        "apple.unavailable",
      )
    }
    this.session = null
    this.setState({ phase: "unpaired" })
  }

  private get codec(): BinaryCodec {
    return new BinaryCodec(Boolean(this.capabilities?.shouldUseBase64))
  }

  /**
   * Asks the helper to show a pairing code on the Mac. While a code is already shown this keeps it,
   * unless `restart` asks for a new one.
   */
  startPairing(restart: boolean): Promise<void> {
    return this.serialized("pair", async () => {
      if (!restart && this.state.phase === "awaitingCode" && this.pairing)
        return
      if (this.state.phase === "paired" && this.session) return
      await this.ensureConnected()
      const version = this.capabilities?.secretSessionVersion
      if (version !== undefined && version !== SRP_WITH_RFC_VERIFICATION) {
        throw new BackendError(
          `Unsupported helper session version ${version}`,
          "apple.unsupported",
        )
      }
      this.session = null
      this.pairing = null
      const client = new SrpClient(this.codec)
      const reply = await this.port.request(
        {
          cmd: Cmd.Handshake,
          msg: JSON.stringify({
            QID: "m0",
            PAKE: encodePake({
              TID: client.username,
              MSG: 0,
              A: client.codec.encode(bigIntToBytes(client.publicKey)),
              VER: PROTOCOL_VERSION,
              PROTO: [SRP_WITH_RFC_VERIFICATION],
            }),
            HSTBRSR: BROWSER_NAME,
          }),
        },
        { timeoutMs: 30_000 },
      )
      const pake = decodePake(payloadOf(reply).PAKE)
      if (
        typeof pake.TID !== "string" ||
        !sameSessionId(client.codec, client.username, pake.TID)
      ) {
        throw new BackendError(
          "Pairing reply belongs to another session",
          "apple.protocol",
        )
      }
      if (pake.ErrCode !== undefined && Number(pake.ErrCode) !== 0) {
        throw new BackendError(
          `Pairing was refused (error ${pake.ErrCode})`,
          "apple.refused",
        )
      }
      if (
        String(pake.MSG) !== "1" ||
        typeof pake.s !== "string" ||
        typeof pake.B !== "string"
      ) {
        throw new BackendError("Unexpected pairing reply", "apple.protocol")
      }
      if (
        pake.PROTO !== undefined &&
        Number(pake.PROTO) !== SRP_WITH_RFC_VERIFICATION
      ) {
        throw new BackendError(
          `Helper chose unsupported protocol ${pake.PROTO}`,
          "apple.unsupported",
        )
      }
      this.pairing = {
        client,
        salt: client.codec.decode(pake.s),
        serverPublicKey: bytesToBigInt(client.codec.decode(pake.B)),
      }
      this.setState({ phase: "awaitingCode" })
    })
  }

  /** Completes pairing with the six-digit code. A wrong code ends this attempt; the user starts a new one. */
  submitCode(code: string): Promise<void> {
    return this.serialized("pair", async () => {
      const pairing = this.pairing
      if (!pairing)
        throw new BackendError("No pairing in progress", "apple.noPairing")
      this.pairing = null
      const { client } = pairing
      try {
        const result = await client.computeProof(
          pairing.salt,
          pairing.serverPublicKey,
          code,
        )
        const reply = await this.port.request(
          {
            cmd: Cmd.Handshake,
            msg: JSON.stringify({
              QID: "m2",
              PAKE: encodePake({
                TID: client.username,
                MSG: 2,
                M: client.codec.encode(result.proof, false),
              }),
            }),
          },
          { timeoutMs: 30_000 },
        )
        const pake = decodePake(payloadOf(reply).PAKE)
        if (
          typeof pake.TID !== "string" ||
          !sameSessionId(client.codec, client.username, pake.TID)
        ) {
          throw new BackendError(
            "Pairing reply belongs to another session",
            "apple.protocol",
          )
        }
        if (String(pake.MSG) !== "3")
          throw new BackendError("Unexpected pairing reply", "apple.protocol")
        if (Number(pake.ErrCode) === 1)
          throw new BackendError("The code is incorrect", "apple.wrongCode")
        if (Number(pake.ErrCode) !== 0) {
          throw new BackendError(
            `Pairing failed (error ${pake.ErrCode})`,
            "apple.refused",
          )
        }
        if (
          typeof pake.HAMK !== "string" ||
          !verifyServerProof(result, client.codec.decode(pake.HAMK))
        ) {
          throw new BackendError(
            "The helper could not prove it knows the code",
            "apple.protocol",
          )
        }
        this.session = await SecureSession.create(
          client.username,
          client.codec,
          result.sessionKey,
        )
        this.setState({ phase: "paired" })
      } catch (error) {
        if (this.port.connected)
          this.setState({ phase: "unpaired", error: errorText(error) })
        throw error
      }
    })
  }

  async sources(): Promise<SourceInfo[]> {
    if (!this.enabled) return []
    const { phase, error } = this.state
    const status =
      phase === "paired"
        ? "ready"
        : phase === "unavailable"
          ? "unavailable"
          : "locked"
    return [
      {
        id: APPLE_SOURCE_ID,
        kind: "apple",
        label: "Apple Passwords",
        status,
        error,
      },
    ]
  }

  async logins(_sourceId: string, page: URL): Promise<LoginSummary[]> {
    const host = page.hostname
    const entries = await this.listEntries(host, { tabId: 0, frameId: 0 })
    return entries.map((entry) => ({
      id: loginId(entry.username, entry.site),
      username: entry.username,
      title: entry.customTitle || entry.site,
      host: entry.site,
    }))
  }

  private async listEntries(host: string, tab: TabRef): Promise<Entry[]> {
    // The helper has crashed on a request with an empty URL, which also ends the session.
    if (!isHostName(host)) return []
    const reply = await this.serialized("list", () =>
      this.query(
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
      .filter(isLoginEntry)
      .map((entry) => {
        const sites = Array.isArray(entry.sites) ? entry.sites.map(String) : []
        return {
          username: textOf(entry.USR),
          site: sites[0] ?? host,
          sites: sites.length ? sites : [host],
          customTitle: textOf(entry.customTitle) || undefined,
        }
      })
  }

  /**
   * Reads one password. macOS asks for Touch ID first; with the prompt dismissed the helper never
   * answers, so this waits without a timeout and a newer read replaces it.
   */
  async credential(
    _sourceId: string,
    id: string,
    page: URL,
    tab: TabRef,
  ): Promise<Credential> {
    const { username, site } = parseLoginId(id)
    if (!isHostName(site))
      throw new BackendError("The login has no site", "unknownLogin")
    // The helper's own listing for the page decides which logins belong to it.
    const listed = await this.listEntries(page.hostname, {
      tabId: 0,
      frameId: 0,
    })
    if (
      !listed.some(
        (entry) => entry.username === username && entry.site === site,
      )
    ) {
      throw new BackendError("The login does not match this page", "notFound")
    }
    let reply: Record<string, unknown>
    try {
      reply = await this.query(
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
    } catch (error) {
      if (error instanceof SupersededError)
        throw new BackendError("Replaced by a newer request", "cancelled")
      throw error
    }
    const password = passwordIn(reply, username, site)
    if (password) return { username, password }
    if (password === null)
      throw new BackendError(
        "Apple Passwords has no password for this login",
        "apple.noPassword",
      )
    throw new BackendError("Apple Passwords returned no password", "notFound")
  }

  async details(
    _sourceId: string,
    id: string,
    page: URL,
  ): Promise<LoginDetails> {
    const { username, site } = parseLoginId(id)
    const tab = { tabId: 0, frameId: 0 }
    const entry = (await this.listEntries(page.hostname, tab)).find(
      (e) => e.username === username && e.site === site,
    )
    if (!entry)
      throw new BackendError("The login does not match this page", "notFound")
    const codes = await this.codeEntries(page, tab).catch(() => [])
    return {
      username,
      name: entry.customTitle,
      uris: entry.sites,
      hasCode: codes.some((c) => isCodeFor(c, username, site)),
      secretsWithheld: false,
    }
  }

  /** Authenticator entries for a page, when the helper can give codes. */
  private async codeEntries(page: URL, tab: TabRef): Promise<CodeEntry[]> {
    await this.ensureConnected()
    if (!this.capabilities?.canFillOneTimeCodes || !isHostName(page.hostname))
      return []
    const frameURLs = await frameChain(page, tab)
    const reply = await this.serialized("codes", () =>
      this.query(
        { cmd: Cmd.GetOneTimeCodes, tabId: tab.tabId, frameId: tab.frameId },
        "CmdGetOneTimeCodes",
        { ACT: Action.GhostSearch, TYPE: "oneTimeCodes", frameURLs },
        { timeoutMs: LIST_TIMEOUT_MS },
      ),
    )
    if (reply.STATUS === QueryStatus.NoResults) return []
    return entriesOf(reply)
      .filter((entry) => entry.source === TOTP_SOURCE)
      .map((entry) => ({
        username: textOf(entry.username),
        domain: textOf(entry.domain) || page.hostname,
      }))
  }

  async codeLogins(
    _sourceId: string,
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
    _sourceId: string,
    id: string,
    page: URL,
    tab: TabRef,
  ): Promise<OneTimeCode> {
    const { username, site } = parseLoginId(id)
    const entries = await this.codeEntries(page, tab)
    // The menu's IDs name the entry's own domain; the popup's name the login's site, which an
    // entry for a subdomain or parent domain may serve.
    const entry =
      entries.find((c) => c.username === username && c.domain === site) ??
      entries.find((c) => isCodeFor(c, username, site))
    if (!entry)
      throw new BackendError("The login has no one-time code", "noCode")
    let reply: Record<string, unknown>
    try {
      reply = await this.query(
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
    } catch (error) {
      if (error instanceof SupersededError)
        throw new BackendError("Replaced by a newer request", "cancelled")
      throw error
    }
    const match = entriesOf(reply).find(
      (e) =>
        e.source === TOTP_SOURCE &&
        textOf(e.username) === entry.username &&
        (textOf(e.domain) || page.hostname) === entry.domain,
    )
    const code = match?.code
    if (typeof code !== "string" && typeof code !== "number")
      throw new BackendError("Apple Passwords returned no code", "noCode")
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
   * listing. Logins it cannot store are refused before the confirmation is shown.
   */
  save(_sourceId: string, login: NewLogin, tab: TabRef): Promise<void> {
    const host = login.url.hostname
    if (!isHostName(host))
      return Promise.reject(new BackendError("Not a host name", "invalidSite"))
    if (!this.canSave(login.url)) {
      return Promise.reject(
        new BackendError(
          "Apple Passwords does not store logins for this host",
          "apple.unsupportedSite",
        ),
      )
    }
    if (
      !login.username.trim() &&
      !this.capabilities?.canSaveAccountWithEmptyUserName
    ) {
      return Promise.reject(
        new BackendError(
          "Apple Passwords needs a username",
          "apple.emptyUsername",
        ),
      )
    }
    return this.serialized("save", async () => {
      this.saveCount += 1
      const frameId = SAVE_FRAME_BASE + this.saveCount
      await this.query(
        { cmd: Cmd.SetPasswordForLoginNameAndUrl, tabId: tab.tabId, frameId },
        "CmdSetPassword4LoginName_URL",
        {
          ACT: Action.MaybeAdd,
          URL: "",
          USR: "",
          PWD: "",
          NURL: host,
          NUSR: login.username,
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
        if (saved.some((entry) => entry.username === login.username)) return
      }
      throw new BackendError(
        "Apple Passwords did not store the login",
        "apple.notSaved",
      )
    })
  }

  update(
    sourceId: string,
    _loginId: string,
    login: NewLogin,
    tab: TabRef,
  ): Promise<void> {
    return this.save(sourceId, login, tab)
  }

  async findExisting(
    _sourceId: string,
    page: URL,
    username: string,
  ): Promise<ExistingLogin | null> {
    const entries = await this.listEntries(page.hostname, {
      tabId: 0,
      frameId: 0,
    })
    const entry = entries.find((e) => e.username === username)
    return entry
      ? {
          loginId: loginId(entry.username, entry.site),
          samePassword: undefined,
        }
      : null
  }

  async lock(): Promise<void> {
    this.session = null
    this.pairing = null
    if (this.port.connected) this.setState({ phase: "unpaired" })
  }

  async lockAll(): Promise<void> {
    await this.lock()
  }

  /** Opens the Passwords app, searching for a site when one is given. */
  async openPasswordsApp(site?: string): Promise<void> {
    await this.ensureConnected()
    this.port.post(
      site && isHostName(site)
        ? { cmd: Cmd.LaunchPasswordsApp, searchQueryURL: `https://${site}` }
        : { cmd: Cmd.LaunchPasswordsApp },
    )
  }

  /** Whether the Passwords app can be handed a verification code to set up right now. */
  canSetUpCodes(): boolean {
    return this.session !== null && this.capabilities?.scanForOTPURI === true
  }

  /**
   * Hands an `otpauth://` URI to the Passwords app, which asks on the Mac which login of the site
   * gets the verification code.
   */
  async setUpCode(site: string, uri: string): Promise<void> {
    if (!isHostName(site))
      throw new BackendError("Not a host name", "invalidSite")
    if (!this.canSetUpCodes())
      throw new BackendError(
        "Apple Passwords cannot set up codes now",
        "locked",
      )
    this.port.post({
      cmd: Cmd.LaunchPasswordsApp,
      setUpTOTPPageURL: site,
      setUpTOTPURI: uri,
    })
  }

  /** Requests of one kind run one after another; different kinds may overlap. */
  private serialized<T>(lane: string, task: () => Promise<T>): Promise<T> {
    const run = (this.lanes.get(lane) ?? Promise.resolve()).then(task, task)
    this.lanes.set(
      lane,
      run.catch(() => undefined),
    )
    return run
  }

  private async query(
    envelope: HelperMessage,
    qid: string,
    body: object,
    options: {
      timeoutMs: number | null
      replyCmd?: number
      matchTab?: boolean
    },
  ): Promise<Record<string, unknown>> {
    await this.ensureConnected()
    const session = this.session
    if (!session)
      throw new BackendError("Apple Passwords needs pairing", "locked")
    const smsg = await session.seal(body)
    const reply = await this.port.request(
      { ...envelope, payload: JSON.stringify({ QID: qid, SMSG: smsg }) },
      options,
    )
    let decoded: Record<string, unknown>
    try {
      decoded = await session.open(payloadOf(reply).SMSG)
    } catch {
      this.dropSession("The helper no longer accepts this session")
      throw new BackendError("Apple Passwords needs pairing", "locked")
    }
    const status = decoded.STATUS
    if (status === QueryStatus.InvalidSession) {
      this.dropSession("The helper ended the session")
      throw new BackendError("Apple Passwords needs pairing", "locked")
    }
    if (status !== QueryStatus.Success && status !== QueryStatus.NoResults) {
      throw new BackendError(
        `Apple Passwords query failed with status ${String(status)}`,
        "apple.query",
      )
    }
    return decoded
  }

  private onUnsolicited(message: HelperMessage): void {
    if (
      message.cmd === Cmd.PasswordsDisabled ||
      message.cmd === Cmd.ReloginNeeded
    ) {
      this.dropSession(`The helper reported command ${message.cmd}`)
    }
  }

  private dropSession(reason: string): void {
    this.session = null
    if (this.port.connected) this.setState({ phase: "unpaired", error: reason })
  }

  private setState(state: AppleState): void {
    this.state = state
    for (const listener of this.listeners) listener(state)
  }
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
  const byId = new Map((frames ?? []).map((f) => [f.frameId, f]))
  let parent = byId.get(tab.frameId)?.parentFrameId ?? -1
  while (parent >= 0 && urls.length <= byId.size) {
    const frame = byId.get(parent)
    if (!frame) break
    urls.push(frame.url)
    parent = frame.parentFrameId
  }
  return urls
}

/** Whether an authenticator entry belongs to the login with this username and site. */
function isCodeFor(entry: CodeEntry, username: string, site: string): boolean {
  return entry.username === username && isSameSite(entry.domain, site)
}

function payloadOf(message: HelperMessage): Record<string, unknown> {
  const payload = message.payload
  if (typeof payload === "string") return JSON.parse(payload)
  if (payload && typeof payload === "object")
    return payload as Record<string, unknown>
  throw new Error(`Helper reply to command ${message.cmd} has no payload`)
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

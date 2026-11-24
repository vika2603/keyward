import { bigIntToBytes, bytesToBigInt } from "@/lib/bytes"
import { isHostOrSubdomain } from "@/lib/site"
import {
  BackendError,
  type Credential,
  type ExistingLogin,
  type LoginSummary,
  type NewLogin,
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
        label: "Apple 密码",
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
    }))
  }

  private async listEntries(
    host: string,
    tab: TabRef,
  ): Promise<{ username: string; site: string; customTitle?: string }[]> {
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
      .filter((entry) => entry.USR !== "Passwords not saved")
      .map((entry) => {
        const sites = Array.isArray(entry.sites) ? entry.sites.map(String) : []
        return {
          username: typeof entry.USR === "string" ? entry.USR : "",
          site: sites[0] ?? host,
          customTitle:
            typeof entry.customTitle === "string"
              ? entry.customTitle
              : undefined,
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
    // A late answer to a replaced read may arrive here; only the login asked for is used.
    const match = entriesOf(reply).find(
      (entry) =>
        (entry.USR ?? "") === username &&
        Array.isArray(entry.sites) &&
        entry.sites.some((s) => isSameSite(String(s), site)),
    )
    if (typeof match?.PWD !== "string")
      throw new BackendError("Apple Passwords returned no password", "notFound")
    return { username, password: match.PWD }
  }

  /**
   * Offers a login to Apple Passwords. macOS shows its own confirmation; the helper answers once
   * the user has chosen, and the answer does not say what was chosen. Hosts such as `.example`
   * or `.localhost` are acknowledged but never stored, so the result is checked by listing.
   */
  save(_sourceId: string, login: NewLogin, tab: TabRef): Promise<void> {
    const host = login.url.hostname
    if (!isHostName(host))
      return Promise.reject(new BackendError("Not a host name", "invalidSite"))
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
      const saved = await this.listEntries(host, tab)
      if (!saved.some((entry) => entry.username === login.username)) {
        throw new BackendError(
          "Apple Passwords did not store the login",
          "apple.notSaved",
        )
      }
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

  async lockAll(): Promise<void> {
    this.session = null
    this.pairing = null
    if (this.port.connected) this.setState({ phase: "unpaired" })
  }

  /** Opens the Passwords app, on the new-password sheet when a URL is given. */
  async openPasswordsApp(newPasswordUrl?: string): Promise<void> {
    await this.ensureConnected()
    this.port.post(
      newPasswordUrl
        ? {
            cmd: Cmd.LaunchPasswordsApp,
            newPasswordWithSuggestedURL: newPasswordUrl,
          }
        : { cmd: Cmd.LaunchPasswordsApp },
    )
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

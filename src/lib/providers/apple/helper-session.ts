import { serialQueue } from "@/lib/serial-queue"
import { VaultError } from "../types"
import {
  type HelperMessage,
  HelperPort,
  type HelperPortEvents,
  payloadOf,
  type RequestOptions,
  SupersededError,
} from "./helper-port"
import {
  type Challenge,
  challengeRequest,
  checkProofReply,
  proofRequest,
  readChallenge,
  SRP_WITH_RFC_VERIFICATION,
} from "./pairing"
import {
  Cmd,
  capabilitiesOf,
  type HelperCapabilities,
  QueryStatus,
  SecureSession,
} from "./protocol"
import { BinaryCodec, SrpClient } from "./srp"

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

/** The parts of the helper port a session uses. */
export type HelperConnection = Pick<
  HelperPort,
  "connected" | "connect" | "disconnect" | "post" | "request"
>

const HELLO_TIMEOUT_MS = 5000
const HANDSHAKE_TIMEOUT_MS = 30_000

/**
 * The connection to the system's PasswordManagerBrowserExtensionHelper and the paired session over
 * it. A session belongs to one helper process, so it lives only in memory and lasts while the
 * native port stays open; the open port in turn keeps the service worker alive. A new browser
 * session pairs again.
 */
export class HelperSession {
  private readonly port: HelperConnection
  private helperCapabilities: HelperCapabilities | null = null
  private session: SecureSession | null = null
  private pairing: (Challenge & { client: SrpClient }) | null = null
  private state: AppleState = { phase: "disabled" }
  private connecting: Promise<void> | null = null
  private readonly pairingSteps = serialQueue()
  private readonly listeners = new Set<(state: AppleState) => void>()
  private readonly codeListeners = new Set<() => void>()

  constructor(
    openPort: (events: HelperPortEvents) => HelperConnection = (events) =>
      new HelperPort(events),
  ) {
    this.port = openPort({
      onUnsolicited: (message) => this.onUnsolicited(message),
      onDisconnect: (reason) => {
        this.forgetHelper()
        if (this.state.phase !== "disabled")
          this.setState({ phase: "unavailable", error: reason })
      },
    })
  }

  onChange(listener: (state: AppleState) => void): void {
    this.listeners.add(listener)
  }

  /** Calls `listener` when the helper says the verification codes it offers have changed. */
  onCodesChanged(listener: () => void): void {
    this.codeListeners.add(listener)
  }

  getState(): AppleState {
    return this.state
  }

  get enabled(): boolean {
    return this.state.phase !== "disabled"
  }

  /** What the connected helper can do; null while not connected. */
  get capabilities(): HelperCapabilities | null {
    return this.helperCapabilities
  }

  get paired(): boolean {
    return this.session !== null
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (!enabled) {
      this.port.disconnect()
      this.forgetHelper()
      this.setState({ phase: "disabled" })
      return
    }
    if (this.state.phase === "disabled") this.setState({ phase: "connecting" })
    await this.ensureConnected().catch(() => {})
  }

  ensureConnected(): Promise<void> {
    if (!this.enabled)
      return Promise.reject(
        new VaultError("Apple Passwords is turned off", "apple.disabled"),
      )
    if (this.port.connected && this.helperCapabilities) return Promise.resolve()
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
        { timeoutMs: HELLO_TIMEOUT_MS },
      )
      this.helperCapabilities = capabilitiesOf(hello.capabilities)
    } catch (error) {
      this.port.disconnect()
      this.forgetHelper()
      this.setState({ phase: "unavailable", error: errorText(error) })
      throw new VaultError(
        "The Apple Passwords helper is not available",
        "apple.unavailable",
      )
    }
    this.session = null
    this.setState({ phase: "unpaired" })
  }

  private get codec(): BinaryCodec {
    return new BinaryCodec(Boolean(this.helperCapabilities?.shouldUseBase64))
  }

  /**
   * Asks the helper to show a pairing code on the Mac. A helper process shows the same code for
   * every handshake, so asking again, as when the pairing page opens again, shows the code already
   * given; one the user just read stays valid. `restart` starts a new helper process for a new code.
   */
  startPairing(restart: boolean): Promise<void> {
    return this.pairingSteps(async () => {
      if (this.state.phase === "paired" && this.session) return
      if (restart) this.endHelperProcess()
      await this.ensureConnected()
      const version = this.helperCapabilities?.secretSessionVersion
      if (version !== undefined && version !== SRP_WITH_RFC_VERIFICATION) {
        throw new VaultError(
          `Unsupported helper session version ${version}`,
          "apple.unsupported",
        )
      }
      this.session = null
      this.pairing = null
      const client = new SrpClient(this.codec)
      const reply = await this.port.request(
        { cmd: Cmd.Handshake, msg: challengeRequest(client) },
        { timeoutMs: HANDSHAKE_TIMEOUT_MS },
      )
      this.pairing = { client, ...readChallenge(client, payloadOf(reply)) }
      this.setState({ phase: "awaitingCode" })
    })
  }

  /** Completes pairing with the six-digit code. A wrong code ends this attempt; the user starts a new one. */
  submitCode(code: string): Promise<void> {
    return this.pairingSteps(async () => {
      const pairing = this.pairing
      if (!pairing)
        throw new VaultError("No pairing in progress", "apple.noPairing")
      this.pairing = null
      const { client } = pairing
      try {
        const result = await client.computeProof(
          pairing.salt,
          pairing.serverPublicKey,
          code,
        )
        const reply = await this.port.request(
          { cmd: Cmd.Handshake, msg: proofRequest(client, result.proof) },
          { timeoutMs: HANDSHAKE_TIMEOUT_MS },
        )
        checkProofReply(client, payloadOf(reply), result)
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

  /**
   * Ends a pairing that waits for its code, as when the view that asked for the code closes. The
   * Mac then closes the window that shows the code; asking again shows it again. This waits for
   * pairing requests already made, then asks `stillWanted` again, since a view may have opened
   * meanwhile.
   */
  cancelPairing(stillWanted: () => boolean = () => false): Promise<void> {
    return this.pairingSteps(async () => {
      const waitingForCode =
        this.state.phase === "awaitingCode" && this.pairing !== null
      if (!waitingForCode || !this.port.connected || stillWanted()) return
      this.port.post({ cmd: Cmd.DidCancelPINPairing })
      this.pairing = null
      this.setState({ phase: "unpaired" })
    })
  }

  /** Ends the session and the helper process, so pairing again shows a new code. */
  lock(): void {
    this.endHelperProcess()
    const { phase } = this.state
    if (phase !== "disabled" && phase !== "unavailable")
      this.setState({ phase: "unpaired" })
  }

  /** Sends a message that has no reply, such as one that opens the Passwords app. */
  post(message: HelperMessage): void {
    this.port.post(message)
  }

  /**
   * Sends an encrypted query over the paired session and opens its reply. A query that a newer
   * one waiting for the same reply replaces fails as cancelled.
   */
  async query(
    envelope: HelperMessage,
    qid: string,
    body: object,
    options: RequestOptions,
  ): Promise<Record<string, unknown>> {
    await this.ensureConnected()
    const session = this.session
    if (!session)
      throw new VaultError("Apple Passwords needs pairing", "locked")
    const smsg = await session.seal(body)
    let reply: HelperMessage
    try {
      reply = await this.port.request(
        { ...envelope, payload: JSON.stringify({ QID: qid, SMSG: smsg }) },
        options,
      )
    } catch (error) {
      if (error instanceof SupersededError)
        throw new VaultError("Replaced by a newer request", "cancelled")
      throw error
    }
    let decoded: Record<string, unknown>
    try {
      decoded = await session.open(payloadOf(reply).SMSG)
    } catch {
      this.dropSession("The helper no longer accepts this session")
      throw new VaultError("Apple Passwords needs pairing", "locked")
    }
    const status = decoded.STATUS
    if (status === QueryStatus.InvalidSession) {
      this.dropSession("The helper ended the session")
      throw new VaultError("Apple Passwords needs pairing", "locked")
    }
    if (status !== QueryStatus.Success && status !== QueryStatus.NoResults) {
      throw new VaultError(
        `Apple Passwords query failed with status ${String(status)}`,
        "apple.query",
      )
    }
    return decoded
  }

  /** Disconnects from the helper, which ends its process; the next request starts a new one. */
  private endHelperProcess(): void {
    this.port.disconnect()
    this.forgetHelper()
  }

  /** Forgets what belonged to the helper process: its capabilities, session and pairing. */
  private forgetHelper(): void {
    this.helperCapabilities = null
    this.session = null
    this.pairing = null
  }

  private onUnsolicited(message: HelperMessage): void {
    if (message.cmd === Cmd.OneTimeCodeAvailable) {
      for (const listener of this.codeListeners) listener()
      return
    }
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

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

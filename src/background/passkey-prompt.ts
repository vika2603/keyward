import type {
  PasskeyBridgeOutcome,
  PasskeyCreateRequest,
  PasskeyGetRequest,
  PasskeyPromptView,
} from "@/lib/passkeys/types"
import { isValidRpId } from "@/lib/passkeys/webauthn"
import type { BitwardenProvider } from "@/lib/providers/bitwarden/bitwarden-provider"
import { VaultError } from "@/lib/providers/types"
import { getSettings } from "@/lib/settings"
import { frameUrl } from "./page"
import { PopupPromptGate, type PopupPromptLifecycle } from "./popup-prompt"

type PendingPasskey =
  | {
      kind: "get"
      requestId: string
      page: URL
      request: PasskeyGetRequest
    }
  | {
      kind: "create"
      requestId: string
      page: URL
      request: PasskeyCreateRequest
    }

/**
 * Coordinates modal WebAuthn `create` and `get` requests between a web frame and Keyward's popup.
 *
 * Coexistence with Apple Passwords / native authenticators:
 * - Pure Apple Passwords users (no Bitwarden accounts configured) always get immediate `"fallback"`.
 * - Modal `get` with no matching Bitwarden passkeys and no locked Bitwarden vaults gets immediate `"fallback"`.
 * - If the popup cannot open in time, falls back to native WebAuthn so sign-in is never blocked.
 * - Inside the popup, users always have a one-click "Use system / Passwords passkey" fallback.
 */
export class PasskeyPrompt implements PopupPromptLifecycle {
  private readonly gate: PopupPromptGate<PendingPasskey, PasskeyBridgeOutcome>

  constructor(
    private readonly bitwarden: BitwardenProvider,
    openChooser: () => Promise<void>,
  ) {
    this.gate = new PopupPromptGate<PendingPasskey, PasskeyBridgeOutcome>(
      openChooser,
      {
        onShowTimeout: () => ({ kind: "fallback" }),
        onTimeout: () => ({ kind: "cancel" }),
        onLeave: () => ({ kind: "cancel" }),
      },
    )
  }

  async handleGet(
    tabId: number,
    frameId: number,
    requestId: string,
    raw: PasskeyGetRequest,
  ): Promise<PasskeyBridgeOutcome> {
    const checked = await this.preflight(tabId, frameId, raw.rpId)
    if ("outcome" in checked) return checked.outcome
    const request: PasskeyGetRequest = {
      ...raw,
      rpId: checked.rpId,
      origin: checked.page.origin,
      crossOrigin: checked.crossOrigin,
    }

    const { passkeys, lockedVaults } = await this.bitwarden.passkeysForRp(
      request.rpId,
      request.allowCredentials,
    )
    if (passkeys.length === 0 && lockedVaults.length === 0)
      return { kind: "fallback" }

    return this.promptUser({
      kind: "get",
      requestId,
      page: checked.page,
      request,
    })
  }

  async handleCreate(
    tabId: number,
    frameId: number,
    requestId: string,
    raw: PasskeyCreateRequest,
  ): Promise<PasskeyBridgeOutcome> {
    const checked = await this.preflight(tabId, frameId, raw.rpId)
    if ("outcome" in checked) return checked.outcome
    const request: PasskeyCreateRequest = {
      ...raw,
      rpId: checked.rpId,
      origin: checked.page.origin,
      crossOrigin: checked.crossOrigin,
    }

    // If an unlocked Bitwarden vault already contains one of `excludeCredentials`, fail with InvalidStateError.
    if (request.excludeCredentials.length > 0) {
      const { passkeys } = await this.bitwarden.passkeysForRp(
        request.rpId,
        request.excludeCredentials,
      )
      if (passkeys.length > 0) {
        return {
          kind: "error",
          name: "InvalidStateError",
          message:
            "A passkey for this account already exists in your Bitwarden vault.",
        }
      }
    }

    const { saveTargets, lockedVaults } =
      await this.bitwarden.passkeySaveTargets(checked.page)
    if (saveTargets.length === 0 && lockedVaults.length === 0)
      return { kind: "fallback" }

    return this.promptUser({
      kind: "create",
      requestId,
      page: checked.page,
      request,
    })
  }

  /** Cancels a pending request if the page aborted it via `AbortSignal`. */
  cancelRequest(requestId: string): void {
    if (this.gate.current?.requestId === requestId)
      this.gate.settle({ kind: "cancel" })
  }

  /** Whether a modal WebAuthn passkey request is currently awaiting user choice. */
  get active(): boolean {
    return this.gate.busy
  }

  /** The popup connected to display the passkey prompt. */
  showing(): void {
    this.gate.showing()
  }

  /** Current passkey prompt state for the popup; null once settled. */
  async view(): Promise<PasskeyPromptView | null> {
    const pending = this.gate.current
    if (!pending) return null
    if (pending.kind === "get") {
      const { passkeys, lockedVaults } = await this.bitwarden.passkeysForRp(
        pending.request.rpId,
        pending.request.allowCredentials,
      )
      return {
        kind: "get",
        rpId: pending.request.rpId,
        rpName: pending.request.rpId,
        origin: pending.request.origin,
        passkeys,
        saveTargets: [],
        lockedVaults,
      }
    }
    const { saveTargets, lockedVaults } =
      await this.bitwarden.passkeySaveTargets(pending.page)
    return {
      kind: "create",
      rpId: pending.request.rpId,
      rpName: pending.request.rpName || pending.request.rpId,
      origin: pending.request.origin,
      passkeys: [],
      userName: pending.request.userName,
      userDisplayName: pending.request.userDisplayName,
      saveTargets,
      lockedVaults,
    }
  }

  /** Signs the pending `get` request with the selected Bitwarden passkey. */
  async choosePasskey(
    vaultId: string,
    loginId: string,
    credentialId: string,
  ): Promise<void> {
    await this.gate.answer(async (pending) => {
      if (pending.kind !== "get")
        throw new VaultError("The site stopped asking", "pageChanged")
      const credential = await this.bitwarden.signPasskey(
        vaultId,
        loginId,
        credentialId,
        pending.request,
      )
      return { kind: "asserted", credential }
    })
  }

  /** Creates and saves a passkey for the pending `create` request in Bitwarden. */
  async savePasskey(vaultId: string, loginId: string | null): Promise<void> {
    await this.gate.answer(async (pending) => {
      if (pending.kind !== "create")
        throw new VaultError("The site stopped asking", "pageChanged")
      const credential = await this.bitwarden.createPasskey(
        vaultId,
        loginId,
        pending.request,
      )
      return { kind: "created", credential }
    })
  }

  /** Hands the pending request off to the browser's native WebAuthn (Apple Passwords / hardware key). */
  fallback(): void {
    this.gate.settle({ kind: "fallback" })
  }

  /** Cancels the pending request (rejects with NotAllowedError in the page). */
  cancel(): void {
    this.gate.settle({ kind: "cancel" })
  }

  /** Called when the popup port disconnects without an explicit choice. */
  leave(): void {
    this.gate.leave()
  }

  /** Checks settings, Bitwarden account presence, and WebAuthn origin/RP ID validity. */
  private async preflight(
    tabId: number,
    frameId: number,
    rawRpId: string,
  ): Promise<
    | { page: URL; rpId: string; crossOrigin: boolean }
    | { outcome: PasskeyBridgeOutcome }
  > {
    if (!(await getSettings()).takeOverPasskeys)
      return { outcome: { kind: "fallback" } }
    if (!(await this.bitwarden.hasConfiguredAccounts()))
      return { outcome: { kind: "fallback" } }
    const page = await frameUrl(tabId, frameId)
    if (!page) {
      return {
        outcome: {
          kind: "error",
          name: "SecurityError",
          message: "Passkeys require a web page origin.",
        },
      }
    }
    const rpId = (rawRpId || page.hostname).trim().toLowerCase()
    if (!isValidRpId(rpId, page.origin)) {
      return {
        outcome: {
          kind: "error",
          name: "SecurityError",
          message: `The relying party ID "${rpId}" is not valid for ${page.origin}.`,
        },
      }
    }
    const top = frameId !== 0 ? await frameUrl(tabId, 0) : page
    const crossOrigin = top !== null && top.origin !== page.origin
    return { page, rpId, crossOrigin }
  }

  private promptUser(pending: PendingPasskey): Promise<PasskeyBridgeOutcome> {
    if (this.gate.busy) {
      return Promise.resolve({
        kind: "error",
        name: "NotAllowedError",
        message: "A passkey request is already pending.",
      })
    }
    return this.gate.ask(pending)
  }
}

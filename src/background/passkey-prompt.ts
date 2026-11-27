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

/** How long a modal passkey prompt waits for user choice before cancelling. */
const CHOICE_MS = 5 * 60_000
/** If the browser fails to display the popup within this window, fall back to native WebAuthn. */
const SHOW_MS = 5000

type PendingRequest =
  | {
      kind: "get"
      requestId: string
      page: URL
      request: PasskeyGetRequest
      shown: boolean
      answering: boolean
      left: boolean
      settle: (outcome: PasskeyBridgeOutcome) => void
    }
  | {
      kind: "create"
      requestId: string
      page: URL
      request: PasskeyCreateRequest
      shown: boolean
      answering: boolean
      left: boolean
      settle: (outcome: PasskeyBridgeOutcome) => void
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
export class PasskeyPrompt {
  private pending: PendingRequest | null = null

  constructor(
    private readonly bitwarden: BitwardenProvider,
    private readonly openChooser: () => Promise<void>,
  ) {}

  async handleGet(
    tabId: number,
    frameId: number,
    requestId: string,
    raw: PasskeyGetRequest,
  ): Promise<PasskeyBridgeOutcome> {
    if (!(await getSettings()).takeOverPasskeys) return { kind: "fallback" }
    if (!(await this.bitwarden.hasConfiguredAccounts()))
      return { kind: "fallback" }

    const checked = await this.verifyOrigin(tabId, frameId, raw.rpId)
    if ("error" in checked) return checked.error
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
    if (!(await getSettings()).takeOverPasskeys) return { kind: "fallback" }
    if (!(await this.bitwarden.hasConfiguredAccounts()))
      return { kind: "fallback" }

    const checked = await this.verifyOrigin(tabId, frameId, raw.rpId)
    if ("error" in checked) return checked.error
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
    if (this.pending?.requestId === requestId) {
      this.pending.settle({ kind: "cancel" })
    }
  }

  /** The popup connected to display the passkey prompt. */
  showing(): void {
    if (this.pending) this.pending.shown = true
  }

  /** Current passkey prompt state for the popup; null once settled. */
  async view(): Promise<PasskeyPromptView | null> {
    const pending = this.pending
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
    const pending = this.requirePending("get")
    pending.answering = true
    try {
      const credential = await this.bitwarden.signPasskey(
        vaultId,
        loginId,
        credentialId,
        pending.request,
      )
      if (this.pending !== pending)
        throw new VaultError("The site stopped asking", "pageChanged")
      pending.settle({ kind: "asserted", credential })
    } finally {
      pending.answering = false
      if (pending.left) pending.settle({ kind: "cancel" })
    }
  }

  /** Creates and saves a passkey for the pending `create` request in Bitwarden. */
  async savePasskey(vaultId: string, loginId: string | null): Promise<void> {
    const pending = this.requirePending("create")
    pending.answering = true
    try {
      const credential = await this.bitwarden.createPasskey(
        vaultId,
        loginId,
        pending.request,
      )
      if (this.pending !== pending)
        throw new VaultError("The site stopped asking", "pageChanged")
      pending.settle({ kind: "created", credential })
    } finally {
      pending.answering = false
      if (pending.left) pending.settle({ kind: "cancel" })
    }
  }

  /** Hands the pending request off to the browser's native WebAuthn (Apple Passwords / hardware key). */
  fallback(): void {
    this.pending?.settle({ kind: "fallback" })
  }

  /** Cancels the pending request (rejects with NotAllowedError in the page). */
  cancel(): void {
    this.pending?.settle({ kind: "cancel" })
  }

  /** Called when the popup port disconnects without an explicit choice. */
  leave(): void {
    const pending = this.pending
    if (!pending) return
    if (pending.answering) pending.left = true
    else pending.settle({ kind: "cancel" })
  }

  private async verifyOrigin(
    tabId: number,
    frameId: number,
    rawRpId: string,
  ): Promise<
    | { page: URL; rpId: string; crossOrigin: boolean }
    | { error: PasskeyBridgeOutcome }
  > {
    const page = await frameUrl(tabId, frameId)
    if (!page) {
      return {
        error: {
          kind: "error",
          name: "SecurityError",
          message: "Passkeys require a web page origin.",
        },
      }
    }
    const rpId = (rawRpId || page.hostname).trim().toLowerCase()
    if (!isValidRpId(rpId, page.origin)) {
      return {
        error: {
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

  private promptUser(
    init:
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
        },
  ): Promise<PasskeyBridgeOutcome> {
    if (this.pending) {
      return Promise.resolve({
        kind: "error",
        name: "NotAllowedError",
        message: "A passkey request is already pending.",
      })
    }
    return new Promise((resolve) => {
      const timer = setTimeout(
        () => pending.settle({ kind: "cancel" }),
        CHOICE_MS,
      )
      const pending: PendingRequest = {
        ...init,
        shown: false,
        answering: false,
        left: false,
        settle: (outcome) => {
          if (this.pending !== pending) return
          clearTimeout(timer)
          this.pending = null
          resolve(outcome)
        },
      }
      this.pending = pending
      this.openChooser().then(
        () =>
          setTimeout(() => {
            if (!pending.shown) pending.settle({ kind: "fallback" })
          }, SHOW_MS),
        () => pending.settle({ kind: "fallback" }),
      )
    })
  }

  private requirePending<K extends "get" | "create">(
    kind: K,
  ): Extract<PendingRequest, { kind: K }> {
    if (!this.pending || this.pending.kind !== kind)
      throw new VaultError("The site stopped asking", "pageChanged")
    return this.pending as Extract<PendingRequest, { kind: K }>
  }
}

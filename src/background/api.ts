import type { AppleState } from "@/lib/backends/apple/apple-backend"
import type { SecondStepMethod } from "@/lib/backends/bitwarden/auth"
import type {
  AccountSummary,
  PendingSignInView,
  SignInOutcome,
} from "@/lib/backends/bitwarden/bitwarden-backend"
import type {
  BackendKind,
  LoginDetails,
  LoginSummary,
  OneTimeCode,
  SourceInfo,
} from "@/lib/backends/types"
import type { Language } from "@/lib/i18n/language"
import { sendRequest } from "@/lib/messaging"

export interface SourceView extends SourceInfo {
  logins: LoginSummary[]
}

export type PopupView =
  | { name: "main" }
  | { name: "generator" }
  | { name: "connect"; kind: BackendKind; sourceId?: string }
  /** Where an authenticator key picked from a page goes. */
  | { name: "codeSetup" }

/** What a field takes: a login, or a one-time code from an authenticator. */
export type FieldKind = "login" | "code"

export interface PageInfo {
  url: string
  host: string
}

export interface HistoryEntry {
  id: string
  password: string
  host: string | null
  at: number
}

export interface ContentConfig {
  active: boolean
  /** Whether a source can take an authenticator key, so QR codes under the pointer are read. */
  scanCodes: boolean
  menuTrigger: "click" | "focus"
  theme: "system" | "light" | "dark"
  language: Language
}

export interface PromptState {
  mode: "save" | "update"
  username: string
  host: string
  targets: SourceInfo[]
  defaultTarget: string | null
  /** The source that holds the login an update replaces. */
  updateSource: SourceInfo | null
}

/** Requests the background answers; `messaging.ts` checks which senders may use each one. */
export type BackgroundApi = {
  "popup.state": {
    payload: null
    result: { page: PageInfo | null; sources: SourceView[] }
  }
  "popup.takeView": { payload: null; result: PopupView }
  "popup.copyPassword": {
    payload: { sourceId: string; loginId: string }
    result: null
  }
  /** Copies text the popup shows; a secret is cleared from the clipboard after a while. */
  "popup.copyText": {
    payload: { text: string; secret?: boolean }
    result: null
  }
  "popup.details": {
    payload: { sourceId: string; loginId: string }
    result: LoginDetails
  }
  "popup.revealPassword": {
    payload: { sourceId: string; loginId: string }
    result: { password: string }
  }
  "popup.oneTimeCode": {
    payload: { sourceId: string; loginId: string }
    result: OneTimeCode
  }
  /** Where a login for the typed site can be saved; `unsupported` cannot store that site. */
  "popup.saveTargets": {
    payload: { site: string }
    result: {
      targets: SourceInfo[]
      defaultTarget: string | null
      unsupported: SourceInfo[]
    }
  }
  /** The authenticator key picked from a page: what it is for and where it can go. */
  "popup.codeSetup": {
    payload: null
    result: {
      host: string
      issuer?: string
      account?: string
      /** Whether the Passwords app can take the key for this site. */
      apple: boolean
      /** Bitwarden accounts that are unlocked, with their logins for the site. */
      sources: SourceView[]
    }
  }
  /** Stores the picked key: in a Bitwarden login, or through the Passwords app. */
  "popup.setUpCode": {
    payload: { sourceId: string; loginId?: string }
    result: null
  }
  /** Locks one Bitwarden account, or ends the Apple pairing. */
  "popup.lock": { payload: { sourceId: string }; result: null }
  /** Locks every account and ends the Apple pairing, as the lock-all shortcut does. */
  "popup.lockAll": { payload: null; result: null }
  "popup.saveLogin": {
    payload: {
      sourceId: string
      site: string
      username: string
      password: string
    }
    result: null
  }
  "apple.state": { payload: null; result: AppleState }
  "apple.startPairing": { payload: { restart: boolean }; result: AppleState }
  "apple.submitCode": { payload: { code: string }; result: AppleState }
  /** Opens the Passwords app, searching for a site when one is given. */
  "apple.openPasswordsApp": { payload: { site?: string }; result: null }
  "bitwarden.accounts": { payload: null; result: AccountSummary[] }
  "bitwarden.unlock": {
    payload: { accountId: string; password: string }
    result: null
  }
  "bitwarden.signOut": { payload: { accountId: string }; result: null }
  "bitwarden.signIn": {
    payload: { server: string; email: string; password: string }
    result: SignInOutcome
  }
  "bitwarden.pendingSignIn": { payload: null; result: PendingSignInView | null }
  "bitwarden.sendEmailCode": { payload: null; result: null }
  "bitwarden.submitSecondStep": {
    payload: { method: SecondStepMethod; code: string }
    result: { accountId: string }
  }
  "bitwarden.cancelSignIn": { payload: null; result: null }
  "generator.copy": { payload: { password: string }; result: null }
  /** Keeps a password generated in the add view in the history; the popup may close before it is saved. */
  "generator.record": {
    payload: { password: string; site: string }
    result: null
  }
  "history.list": { payload: null; result: HistoryEntry[] }
  "history.copy": { payload: { id: string }; result: null }
  "history.clear": { payload: null; result: null }
  "menu.state": {
    payload: { token: string }
    result: { host: string; kind: FieldKind; sources: SourceView[] }
  }
  "menu.fill": {
    payload: { token: string; sourceId: string; loginId: string }
    result: null
  }
  "menu.resize": { payload: { token: string; height: number }; result: null }
  "menu.close": { payload: { token: string }; result: null }
  "menu.connect": { payload: { token: string; sourceId: string }; result: null }
  "prompt.state": { payload: { token: string }; result: PromptState }
  "prompt.confirm": {
    payload: { token: string; targetId: string | null }
    result: null
  }
  "prompt.never": { payload: { token: string }; result: null }
  "prompt.close": { payload: { token: string }; result: null }
  "prompt.resize": { payload: { token: string; height: number }; result: null }
  "content.init": { payload: null; result: ContentConfig }
  /** What is under the pointer: a link's URI or a picture as a PNG; empty when it is neither. */
  "content.codeCandidate": {
    payload: { uri?: string; image?: string }
    result: boolean
  }
  "content.openMenu": {
    payload: { kind: FieldKind }
    result: { token: string }
  }
  /** Whether a ready source has one-time codes for the frame, asked once the frame has a code field. */
  "content.hasCodes": { payload: null; result: boolean }
  "content.closeMenu": { payload: null; result: null }
  "content.submitted": {
    payload: { username: string; password: string }
    result: null
  }
  "content.ready": { payload: null; result: null }
}

export function callBackground<K extends keyof BackgroundApi & string>(
  type: K,
  payload: BackgroundApi[K]["payload"],
): Promise<BackgroundApi[K]["result"]> {
  return sendRequest<BackgroundApi, K>(type, payload)
}

/** Messages the background sends to content scripts in a given frame. */
export type ContentMessage =
  | {
      type: "fill"
      origin: string
      username: string
      password: string
      autoSubmit: boolean
    }
  | { type: "fillCode"; origin: string; code: string }
  | { type: "menu.resize"; height: number }
  | { type: "menu.close" }
  | { type: "prompt.show"; token: string }
  | { type: "prompt.resize"; height: number }
  | { type: "prompt.close" }
  | { type: "fieldInfo" }

export interface FieldInfo {
  hasField: boolean
  focused: boolean
}

export const CONTENT_MESSAGE = "keywardContent"

/**
 * A storage.local key whose value changes when sources become ready or locked or their items
 * change. Content scripts cannot read storage.session or the Apple session, so they reconfigure
 * on this instead. It holds only a time stamp.
 */
export const SOURCES_CHANGED_KEY = "sources.changedAt"

export function isContentMessage(
  message: unknown,
): message is { [CONTENT_MESSAGE]: 1 } & ContentMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    CONTENT_MESSAGE in message
  )
}

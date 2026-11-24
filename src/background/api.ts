import type { AppleState } from "@/lib/backends/apple/apple-backend"
import type { SecondStepMethod } from "@/lib/backends/bitwarden/auth"
import type {
  AccountSummary,
  PendingSignInView,
  SignInOutcome,
} from "@/lib/backends/bitwarden/bitwarden-backend"
import type {
  BackendKind,
  LoginSummary,
  SourceInfo,
} from "@/lib/backends/types"
import { sendRequest } from "@/lib/messaging"

export interface SourceView extends SourceInfo {
  logins: LoginSummary[]
}

export type PopupView =
  | { name: "main" }
  | { name: "generator" }
  | { name: "connect"; kind: BackendKind; sourceId?: string }

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
  menuTrigger: "click" | "focus"
  theme: "system" | "light" | "dark"
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
  "popup.copyText": { payload: { text: string }; result: null }
  "popup.saveTargets": {
    payload: null
    result: { targets: SourceInfo[]; defaultTarget: string | null }
  }
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
  "apple.openPasswordsApp": { payload: null; result: null }
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
  "history.list": { payload: null; result: HistoryEntry[] }
  "history.copy": { payload: { id: string }; result: null }
  "history.clear": { payload: null; result: null }
  "menu.state": {
    payload: { token: string }
    result: { host: string; sources: SourceView[] }
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
  "content.openMenu": { payload: null; result: { token: string } }
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

export function isContentMessage(
  message: unknown,
): message is { [CONTENT_MESSAGE]: 1 } & ContentMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    CONTENT_MESSAGE in message
  )
}

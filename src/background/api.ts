import type { GeneratorKind } from "@/lib/generator"
import type { Language } from "@/lib/i18n/language"
import { sendRequest } from "@/lib/messaging"
import type { FieldRules } from "@/lib/password-rules"
import type { AppleState } from "@/lib/providers/apple/helper-session"
import type { SecondStepMethod } from "@/lib/providers/bitwarden/auth"
import type {
  AccountSummary,
  PendingSignInView,
  SignInOutcome,
} from "@/lib/providers/bitwarden/bitwarden-provider"
import type { CustomEndpoints } from "@/lib/providers/bitwarden/server"
import type {
  EditableLogin,
  EditableNote,
  FillField,
  Folder,
  LoginDetails,
  LoginEdit,
  LoginSummary,
  NewLoginDetails,
  NoteDetails,
  NoteSummary,
  OneTimeCode,
  PastPassword,
  ProviderKind,
  TrashedItem,
  VaultGroups,
  VaultInfo,
} from "@/lib/providers/types"

export interface VaultView extends VaultInfo {
  logins: LoginSummary[]
  /** Secure notes, listed only in search results and the whole vault. */
  notes?: NoteSummary[]
  /** Given with the whole vault, by providers that group their items. */
  groups?: VaultGroups
  /** Given with the whole vault, by providers with a trash. */
  trashed?: TrashedItem[]
}

export type PopupView =
  | { name: "main" }
  | { name: "generator" }
  /** `back` names the view to return to once connected; the main view otherwise. */
  | {
      name: "connect"
      kind: ProviderKind
      vaultId?: string
      back?: "codeSetup"
    }
  /** Where an authenticator key picked from a page goes. */
  | { name: "codeSetup" }
  /** A new login for the active page, asked for from the in-page menu. */
  | { name: "add" }

/** What a field takes: a login, or a one-time code from an authenticator. */
export type FieldKind = "login" | "code"

export interface PageInfo {
  url: string
  host: string
}

export interface HistoryEntry {
  id: string
  value: string
  kind: GeneratorKind
  host: string | null
  at: number
}

/** An entry as versions that kept only passwords store and send it: named `password`, with no kind. */
export type EarlierHistoryEntry = Omit<HistoryEntry, "value" | "kind"> & {
  value?: string
  password?: string
  kind?: GeneratorKind
}

/** An entry of any version, as the current one reads it. */
export function historyEntryOf({
  password,
  ...entry
}: EarlierHistoryEntry): HistoryEntry {
  return {
    ...entry,
    value: entry.value ?? password ?? "",
    kind: entry.kind ?? "password",
  }
}

export interface ContentConfig {
  active: boolean
  /** Whether a vault can take an authenticator key, so QR codes under the pointer are read. */
  scanCodes: boolean
  menuTrigger: "click" | "focus"
  /**
   * Whether the frame keeps a page's passkey request for the menu while it has login fields: when
   * the setting is on and a passkey sign-in succeeded on the site before.
   */
  takeOverPasskeys: boolean
  theme: "system" | "light" | "dark"
  language: Language
}

export interface PromptState {
  mode: "save" | "update"
  username: string
  host: string
  targets: VaultInfo[]
  defaultTarget: string | null
  /** The vault that holds the login an update replaces. */
  updateVault: VaultInfo | null
}

/** Requests the background answers; `messaging.ts` checks which senders may use each one. */
export type BackgroundApi = {
  "popup.state": {
    payload: null
    result: { page: PageInfo | null; vaults: VaultView[] }
  }
  "popup.takeView": { payload: null; result: PopupView }
  /** Every login and note of each vault that can list itself whole, for browsing in the popup. */
  "popup.allItems": { payload: null; result: VaultView[] }
  /** Logins of the whole vault matching the query, per vault. */
  "popup.search": { payload: { query: string }; result: VaultView[] }
  /**
   * The popup's reads below take any login of the vault, as a search finds them; what they return
   * stays in the popup or goes to the clipboard, never into a page.
   */
  "popup.copyPassword": {
    payload: { vaultId: string; loginId: string }
    result: null
  }
  /** Copies text the popup shows; a secret is cleared from the clipboard after a while. */
  "popup.copyText": {
    payload: { text: string; secret?: boolean }
    result: null
  }
  "popup.details": {
    payload: { vaultId: string; loginId: string }
    result: LoginDetails
  }
  "popup.revealPassword": {
    payload: { vaultId: string; loginId: string }
    result: { password: string }
  }
  "popup.oneTimeCode": {
    payload: { vaultId: string; loginId: string }
    result: OneTimeCode
  }
  "popup.note": {
    payload: { vaultId: string; noteId: string }
    result: NoteDetails
  }
  /** A note's fields for the edit view, when its details say it is editable. */
  "popup.editableNote": {
    payload: { vaultId: string; noteId: string }
    result: EditableNote
  }
  /** Vaults a new secure note can be saved to. */
  "popup.noteTargets": { payload: null; result: VaultInfo[] }
  "popup.saveNote": {
    payload: { vaultId: string; note: EditableNote }
    result: null
  }
  "popup.editNote": {
    payload: { vaultId: string; noteId: string; note: EditableNote }
    result: null
  }
  /** Moves a note to the provider's trash. */
  "popup.removeNote": {
    payload: { vaultId: string; noteId: string }
    result: null
  }
  /** A login's earlier passwords, when its details count them. */
  "popup.passwordHistory": {
    payload: { vaultId: string; loginId: string }
    result: PastPassword[]
  }
  /** A login's fields for the edit view, when its details say it is editable. */
  "popup.editable": {
    payload: { vaultId: string; loginId: string }
    result: EditableLogin
  }
  "popup.editLogin": {
    payload: { vaultId: string; loginId: string; change: LoginEdit }
    result: null
  }
  /** Opens, for a short while, an item that asks for the master password again. */
  "popup.passReprompt": {
    payload: { vaultId: string; itemId: string; password: string }
    result: null
  }
  /** Takes a login or note out of the trash. */
  "popup.restoreItem": {
    payload: { vaultId: string; itemId: string }
    result: null
  }
  /** Deletes a login or note in the trash for good. */
  "popup.purgeItem": {
    payload: { vaultId: string; itemId: string }
    result: null
  }
  /** Stars a login or a note, or takes its star away. */
  "popup.setFavorite": {
    payload: { vaultId: string; itemId: string; favorite: boolean }
    result: null
  }
  /** Moves a login to the provider's trash. */
  "popup.removeLogin": {
    payload: { vaultId: string; loginId: string }
    result: null
  }
  /** Where a login for the typed site can be saved; `unsupported` cannot store that site. */
  "popup.saveTargets": {
    payload: { site: string }
    result: {
      targets: VaultInfo[]
      defaultTarget: string | null
      unsupported: VaultInfo[]
    }
  }
  /** The authenticator key picked from a page: what it is for and where it can go. */
  "popup.codeSetup": {
    payload: null
    result: {
      host: string
      issuer?: string
      account?: string
      /** Whether the Passwords app can take the key for this site; it asks for the login itself. */
      apple: boolean
      /** Open vaults that take the key into a login picked here, with their logins for the site. */
      vaults: VaultView[]
      /** Vaults that could take the key once paired or unlocked. */
      locked: VaultInfo[]
    }
  }
  /** Stores the picked key: in a Bitwarden login, or through the Passwords app. */
  "popup.setUpCode": {
    payload: { vaultId: string; loginId?: string }
    result: null
  }
  /** Locks one Bitwarden account, or ends the Apple pairing. */
  "popup.lock": { payload: { vaultId: string }; result: null }
  /** Locks every account and ends the Apple pairing, as the lock-all shortcut does. */
  "popup.lockAll": { payload: null; result: null }
  "popup.saveLogin": {
    payload: {
      vaultId: string
      site: string
      username: string
      password: string
      /** The rest of the login, for a vault that keeps it. */
      details?: NewLoginDetails
    }
    result: null
  }
  /** The folders a new item can be filed in, for a vault that has folders. */
  "popup.folders": { payload: { vaultId: string }; result: Folder[] }
  "apple.state": { payload: null; result: AppleState }
  "apple.startPairing": { payload: { restart: boolean }; result: AppleState }
  /**
   * Connects to the helper without pairing, so nothing shows on the Mac, and turns Passwords on
   * once it answers. While this Mac lacks the one-time setup, Passwords stays as it was and the
   * state says so.
   */
  "apple.checkSetup": { payload: null; result: AppleState }
  "apple.submitCode": { payload: { code: string }; result: AppleState }
  /** Opens the Passwords app, searching for a site when one is given. */
  "apple.openPasswordsApp": { payload: { site?: string }; result: null }
  /** Opens the Passwords app's form for a new password with the site filled in. */
  "apple.openNewPasswordSheet": { payload: { site: string }; result: null }
  "bitwarden.accounts": { payload: null; result: AccountSummary[] }
  "bitwarden.unlock": {
    payload: { accountId: string; password: string }
    result: null
  }
  "bitwarden.signOut": { payload: { accountId: string }; result: null }
  /** Names an account in the interface; an empty name shows its email address again. */
  "bitwarden.renameAccount": {
    payload: { accountId: string; name: string }
    result: null
  }
  /** Fetches an unlocked account's items from its server now. */
  "bitwarden.sync": { payload: { accountId: string }; result: null }
  "bitwarden.signIn": {
    payload: {
      server: string
      /** API and identity addresses of a self-hosted server, when they do not follow from `server`. */
      endpoints?: CustomEndpoints
      email: string
      password: string
    }
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
  /** A value the generator view shows; it enters the history once it settles, or at once when it is copied. */
  "generator.shown": {
    payload: { value: string; kind: GeneratorKind; copied?: boolean }
    result: null
  }
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
    result: {
      host: string
      kind: FieldKind
      vaults: VaultView[]
      /** A generated password offered for a field that takes a new one. */
      suggestion?: string
      /** Whether the page waits for a passkey sign-in, which the menu offers. */
      passkey?: boolean
    }
  }
  "menu.fill": {
    payload: { token: string; vaultId: string; loginId: string }
    result: null
  }
  /** Fills the offered password into the new-password fields of the menu's form. */
  "menu.fillSuggestion": { payload: { token: string }; result: null }
  /** Has the page sign in with a passkey, through the browser's passkey dialog. */
  "menu.usePasskey": { payload: { token: string }; result: null }
  "menu.resize": { payload: { token: string; height: number }; result: null }
  "menu.close": { payload: { token: string }; result: null }
  "menu.connect": { payload: { token: string; vaultId: string }; result: null }
  /** Opens the popup's form for a new login on the page. */
  "menu.newLogin": { payload: { token: string }; result: null }
  "prompt.state": { payload: { token: string }; result: PromptState }
  "prompt.confirm": {
    payload: {
      token: string
      targetId: string | null
      /** For a vault that keeps them: the new login's name, empty for its site, and folder. */
      name?: string
      folderId?: string | null
    }
    result: null
  }
  /** The folders of one of the prompt's vaults. */
  "prompt.folders": {
    payload: { token: string; vaultId: string }
    result: Folder[]
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
    /**
     * `newPassword` for a field that takes a new password, which gets a generated one offered
     * within `fieldRules`; `passkey` when the page waits for a passkey sign-in.
     */
    payload: {
      kind: FieldKind
      newPassword?: boolean
      fieldRules?: FieldRules
      passkey?: boolean
    }
    result: { token: string }
  }
  /** Whether a ready vault has one-time codes for the frame, asked once the frame has a code field. */
  "content.hasCodes": { payload: null; result: boolean }
  /** The page got a passkey credential; the site's passkey requests go to the menu from now on. */
  "content.passkeyUsed": { payload: null; result: null }
  "content.closeMenu": { payload: null; result: null }
  "content.submitted": {
    /**
     * `newPassword` when the password was typed into a field for a new one; `usernameOnPage` the
     * account the page names without a field for it, for when `username` is empty.
     */
    payload: {
      username: string
      password: string
      newPassword?: boolean
      usernameOnPage?: string
    }
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
      /** Custom fields for the page fields of the same name. */
      fields: FillField[]
      autoSubmit: boolean
    }
  | { type: "fillCode"; origin: string; code: string }
  /** A generated password for the new-password fields of the menu's form. */
  | { type: "fillNew"; origin: string; password: string }
  /** What the fields `fillNew` would fill set for a password, answered with `FieldRules` or null. */
  | { type: "newPasswordRules" }
  | { type: "usePasskey" }
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
 * A storage.local key whose value changes when vaults become ready or locked or their items
 * change. Content scripts cannot read storage.session or the Apple session, so they reconfigure
 * on this instead. It holds only a time stamp.
 */
export const VAULTS_CHANGED_KEY = "sources.changedAt"

/**
 * A view that asks for the Passwords pairing code holds a port of this name open. When the last
 * one closes while the code is awaited, the pairing ends and the Mac closes its code window.
 */
export const APPLE_PAIRING_PORT = "apple-pairing"

export function isContentMessage(
  message: unknown,
): message is { [CONTENT_MESSAGE]: 1 } & ContentMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    CONTENT_MESSAGE in message
  )
}

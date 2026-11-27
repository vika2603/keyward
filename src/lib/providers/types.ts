/**
 * The contract every password provider implements. The popup, the in-page menu and the save prompt
 * only use this interface, so adding a password manager means adding one implementation and its
 * connect screen. A provider exposes one or more vaults: Apple Passwords is one vault, each
 * signed-in Bitwarden account is another.
 */

import type { ErrorCode } from "@/lib/error-codes"
import type { MatchType } from "@/lib/settings"

export type ProviderKind = "apple" | "bitwarden"

export type VaultStatus =
  /** Logins can be listed and read. */
  | "ready"
  /** Needs pairing or unlocking first. */
  | "locked"
  /** Cannot be reached at all, for example when the system helper is missing. */
  | "unavailable"

export interface VaultInfo {
  id: string
  kind: ProviderKind
  /** An account's email address; the interface names Apple Passwords itself. */
  label: string
  status: VaultStatus
  error?: string
  /** The user is part way through connecting it, as while the Mac shows a pairing code. */
  awaitingUser?: boolean
  /** It cannot connect until a one-time setup outside the browser is done. */
  needsSetup?: boolean
}

/** Where a Bitwarden item sits; the popup narrows its list by these. */
export interface ItemGrouping {
  /** The organization that owns the item; null for the account's own vault. */
  organizationId: string | null
  folderId: string | null
  collectionIds: string[]
}

/** A vault's organizations, folders and collections by name, for narrowing its list. */
export interface VaultGroups {
  organizations: { id: string; name: string }[]
  folders: { id: string; name: string }[]
  collections: { id: string; organizationId: string; name: string }[]
}

/** A login without its password, as lists and menus show it. */
export interface LoginSummary {
  /** Unique within its vault. */
  id: string
  username: string
  /** The line under the user name: the site for Apple, the item name for Bitwarden. */
  title: string
  /** The host of the login's site, for its icon. */
  host?: string
  /** Whether the login is known to give one-time codes. */
  hasCode?: boolean
  /** The login this tab signed in with on the site moments ago, listed first for its code. */
  recent?: boolean
  grouping?: ItemGrouping
  /** Left out by providers without favorites. */
  favorite?: boolean
}

/** What the detail view shows of a login. The password and one-time code are read on request. */
export interface LoginDetails {
  username: string
  /** The item name, when the provider keeps one apart from the site. */
  name?: string
  /** Addresses the login is saved for. */
  uris: string[]
  notes?: string
  hasCode: boolean
  /** Whether the login's password and code are left to the provider's own apps, as Bitwarden does for items that ask for the master password again. */
  secretsWithheld: boolean
  /** Whether Keyward can edit and delete the login. */
  editable: boolean
  /** Fields the user added to the login, in their saved order. */
  customFields?: CustomField[]
  /** Whether the user starred the login; left out by providers without favorites. */
  favorite?: boolean
  /** Whether the login keeps a passkey; left out when the provider cannot tell. */
  hasPasskey?: boolean
  /** How many earlier passwords the provider keeps for the login; read with `passwordHistory`. */
  pastPasswordCount?: number
  /** Milliseconds since the epoch. */
  created?: number
  modified?: number
  passwordModified?: number
}

/** A field the user added to a login. A hidden field's value is a secret, shown on request. */
export type CustomField =
  | { kind: "text" | "hidden"; name: string; value: string }
  | { kind: "checkbox"; name: string; checked: boolean }
  /** Stands for one of the login's own fields when a page asks for it under this name. */
  | { kind: "linked"; name: string; linkedTo: "username" | "password" }

/** A secure note as lists show it: a named text kept apart from logins. */
export interface NoteSummary {
  id: string
  name: string
  grouping?: ItemGrouping
  favorite?: boolean
}

export interface NoteDetails {
  name: string
  /** Left out when the note's contents are withheld. */
  text?: string
  customFields?: CustomField[]
  /** Whether the note's contents are left to the provider's own apps, as for logins. */
  withheld: boolean
  editable: boolean
  favorite?: boolean
  /** Milliseconds since the epoch. */
  created?: number
  modified?: number
}

/** A note's fields for a new note or an edit form. */
export interface EditableNote {
  name: string
  text: string
  customFields: CustomField[]
}

export interface PastPassword {
  password: string
  /** When the password was replaced, in milliseconds since the epoch. */
  replaced?: number
}

export interface OneTimeCode {
  code: string
  /** Seconds each code lasts, when the provider says. */
  period?: number
  /** When the code stops being valid, in milliseconds since the epoch, when the provider says. */
  expiresAt?: number
}

export interface Credential {
  username: string
  password: string
  /** Custom fields that go into the page fields of the same name. */
  fields?: FillField[]
  /** Whether the login has an HTTPS address for this site, so filling on HTTP warns first. */
  hasHttpsUri?: boolean
}

/** A custom field to fill: text for a text field, or the state of a check box. */
export type FillField =
  | { name: string; text: string }
  | { name: string; checked: boolean }

/**
 * A frame of a tab, which one-time codes are listed or filled for. Apple's helper is told the URLs of
 * the frames around it.
 */
export interface FrameRef {
  tabId: number
  frameId: number
}

export interface NewLogin {
  url: URL
  username: string
  password: string
  /** The rest of a new login, for providers that keep it; others store the fields above only. */
  details?: NewLoginDetails
}

export interface NewLoginDetails {
  /** Empty to name the login after its site. */
  name: string
  notes: string
  /** An authenticator key, as an edit form takes it; empty for none. */
  totp: string
  customFields: CustomField[]
  folderId: string | null
}

/** A login or note in the provider's trash. */
export interface TrashedItem {
  id: string
  kind: "login" | "note"
  name: string
  username?: string
  /** The host of a login's site, for its icon. */
  host?: string
  /** Milliseconds since the epoch. */
  deletedAt?: number
  /** Whether Keyward may restore or delete it; read-only items of an organization stay as they are. */
  editable: boolean
  grouping?: ItemGrouping
}

/** A folder an item can be filed in. */
export interface Folder {
  id: string
  name: string
}

/** A login's web address and how pages are compared with it; null follows the site rules. */
export interface Website {
  uri: string
  match: MatchType | null
}

/** A login's fields as an edit form shows them, secrets included. */
export interface EditableLogin {
  name: string
  username: string
  password: string
  uris: Website[]
  notes: string
  /** The authenticator key as saved: an `otpauth://` URI, a `steam://` key or a base32 secret. */
  totp: string
  customFields: CustomField[]
}

/** New values for a login's fields; fields left out stay as they are. */
export type LoginEdit = Partial<EditableLogin>

/** An existing login for a page and user name, used to decide between a save and an update prompt. */
export interface ExistingLogin {
  loginId: string
  /** Whether the saved password equals the submitted one; undefined when the provider cannot tell without asking the user. */
  samePassword: boolean | undefined
  /**
   * False when Keyward may not change the login, such as an organization's read-only item, so no
   * update is offered for it; missing when it can be changed.
   */
  editable?: boolean
}

/** Everything a vault holds, for providers that can list a whole vault. */
export interface VaultContents {
  logins: LoginSummary[]
  notes: NoteSummary[]
  groups?: VaultGroups
  trashed?: TrashedItem[]
}

/**
 * How a vault takes an authenticator key a page offers: into a login the user picks in Keyward,
 * or through the provider's own app, which asks which login gets it.
 */
export type CodeSetup = "login" | "app"

export interface ListOptions {
  /**
   * A lookup the user did not ask for, such as the toolbar's count of logins; it does not count as
   * use, so accounts still lock when idle.
   */
  passive?: boolean
}

export interface VaultProvider {
  readonly kind: ProviderKind
  /** Whether a vault ID names one of this provider's vaults. */
  ownsVault(vaultId: string): boolean
  vaults(): Promise<VaultInfo[]>
  logins(
    vaultId: string,
    page: URL,
    options?: ListOptions,
  ): Promise<LoginSummary[]>
  /**
   * Logins whose name, username or address contain every word of the query, from the whole
   * vault. A provider that can only look up a site answers a query that is a host name.
   */
  search(vaultId: string, query: string): Promise<LoginSummary[]>
  /**
   * Whether a vault that is not open keeps logins for the page; only providers that can tell
   * without opening the vault have it.
   */
  keepsLoginsFor?(vaultId: string, page: URL): Promise<boolean>
  /**
   * Reads one login's password; may ask the user to authenticate. `page` is the page the login is
   * read for, which it must match. Null is for a login the user picked in Keyward's own views from
   * the whole vault, as from a search; what is read that way never goes into a page.
   */
  credential(
    vaultId: string,
    loginId: string,
    page: URL | null,
  ): Promise<Credential>
  /** Describes one login; `page` as for `credential`. */
  details(
    vaultId: string,
    loginId: string,
    page: URL | null,
  ): Promise<LoginDetails>
  /** Logins of the frame's page that give one-time codes. */
  codeLogins(
    vaultId: string,
    page: URL,
    frame: FrameRef,
  ): Promise<LoginSummary[]>
  /**
   * The current one-time code of a login; may ask the user to authenticate. `page` as for
   * `credential`; `frame` is the frame the code goes into, and none for Keyward's own views.
   */
  oneTimeCode(
    vaultId: string,
    loginId: string,
    page: URL | null,
    frame?: FrameRef,
  ): Promise<OneTimeCode>
  /** Earlier passwords of a login, newest first; only providers whose details count them have it. */
  passwordHistory?(vaultId: string, loginId: string): Promise<PastPassword[]>
  /** Every login and note of a vault; only providers that can list a whole vault have it. */
  allItems?(vaultId: string): Promise<VaultContents>
  /** Secure notes whose name contains every word of the query; only providers with notes have these. */
  searchNotes?(vaultId: string, query: string): Promise<NoteSummary[]>
  note?(vaultId: string, noteId: string): Promise<NoteDetails>
  editableNote?(vaultId: string, noteId: string): Promise<EditableNote>
  saveNote?(vaultId: string, note: EditableNote): Promise<void>
  editNote?(vaultId: string, noteId: string, note: EditableNote): Promise<void>
  /** A login's fields for an edit form; only providers whose details say `editable` have it. */
  editable?(vaultId: string, loginId: string): Promise<EditableLogin>
  edit?(vaultId: string, loginId: string, change: LoginEdit): Promise<void>
  /** Moves a login or note to the trash, where the provider's own apps can restore it. */
  remove?(vaultId: string, itemId: string): Promise<void>
  /** The folders new items can be filed in; only providers with folders have these. */
  folders?(vaultId: string): Promise<Folder[]>
  /** Opens, for a short while, a login or note that asks for the master password again. */
  passReprompt?(
    vaultId: string,
    itemId: string,
    password: string,
  ): Promise<void>
  /** Takes a login or note out of the trash. */
  restore?(vaultId: string, itemId: string): Promise<void>
  /** Deletes a login or note in the trash for good. */
  purge?(vaultId: string, itemId: string): Promise<void>
  /** Stars a login or note, or takes its star away. */
  setFavorite?(
    vaultId: string,
    itemId: string,
    favorite: boolean,
  ): Promise<void>
  /**
   * How the vault takes an authenticator key for the page, or null when it cannot. A locked vault
   * answers for once it is open, so the user is offered to open it first.
   */
  codeSetup?(vaultId: string, page: URL): CodeSetup | null
  /** Adds an authenticator key to `loginId`, or through the provider's app for an "app" setup. */
  setUpCode?(
    vaultId: string,
    loginId: string | null,
    page: URL,
    uri: string,
  ): Promise<void>
  /** Whether the provider can store a login for this address; a save prompt offers only those that can. */
  canSave(url: URL): boolean
  /** Whether the user told the provider never to save logins for the page's site; a save prompt leaves it out. */
  refusesSaving?(vaultId: string, page: URL): Promise<boolean>
  save(vaultId: string, login: NewLogin): Promise<void>
  update(vaultId: string, loginId: string, login: NewLogin): Promise<void>
  findExisting(
    vaultId: string,
    page: URL,
    username: string,
    password: string,
  ): Promise<ExistingLogin | null>
  /** Locks one vault; it needs pairing or unlocking again before use. */
  lock(vaultId: string): Promise<void>
  lockAll(): Promise<void>
}

/** A failure a request reports to its page by code; providers throw it, or a kind of it, for theirs. */
export class VaultError extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

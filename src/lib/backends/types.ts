/**
 * The contract every password backend implements. The popup, the in-page menu and the save prompt
 * only use this interface, so adding a password manager means adding one implementation and its
 * connect screen. A backend exposes one or more sources: Apple Passwords is one source, each
 * signed-in Bitwarden account is another.
 */

export type BackendKind = "apple" | "bitwarden"

export type SourceStatus =
  /** Logins can be listed and read. */
  | "ready"
  /** Needs pairing or unlocking first. */
  | "locked"
  /** Cannot be reached at all, for example when the system helper is missing. */
  | "unavailable"

export interface SourceInfo {
  id: string
  kind: BackendKind
  /** An account's email address; the interface names Apple Passwords itself. */
  label: string
  status: SourceStatus
  error?: string
}

/** A login without its password, as lists and menus show it. */
export interface LoginSummary {
  /** Unique within its source. */
  id: string
  username: string
  /** The line under the user name: the site for Apple, the item name for Bitwarden. */
  title: string
  /** The host of the login's site, for its icon. */
  host?: string
  /** Whether the login is known to give one-time codes; Apple tells only when asked for codes. */
  hasCode?: boolean
  /** The login this tab signed in with on the site moments ago, listed first for its code. */
  recent?: boolean
}

/** What the detail view shows of a login. The password and one-time code are read on request. */
export interface LoginDetails {
  username: string
  /** The item name, when the backend keeps one apart from the site. */
  name?: string
  /** Addresses the login is saved for. */
  uris: string[]
  notes?: string
  hasCode: boolean
  /** Whether the login's password and code are left to the backend's own apps, as Bitwarden does for items that ask for the master password again. */
  secretsWithheld: boolean
  /** Whether Keyward can edit and delete the login. */
  editable: boolean
  /** Milliseconds since the epoch. */
  created?: number
  modified?: number
  passwordModified?: number
}

export interface OneTimeCode {
  code: string
  /** Seconds each code lasts, when the backend says. */
  period?: number
  /** When the code stops being valid, in milliseconds since the epoch, when the backend says. */
  expiresAt?: number
}

export interface Credential {
  username: string
  password: string
}

/** Where a request comes from, passed through to backends that report it to their host. */
export interface TabRef {
  tabId: number
  frameId: number
}

export interface NewLogin {
  url: URL
  username: string
  password: string
}

/** A login's fields as an edit form shows them, secrets included. */
export interface EditableLogin {
  name: string
  username: string
  password: string
  uris: string[]
  notes: string
  /** The authenticator key as saved: an `otpauth://` URI, a `steam://` key or a base32 secret. */
  totp: string
}

/** New values for a login's fields; fields left out stay as they are. */
export type LoginEdit = Partial<EditableLogin>

/** An existing login for a page and user name, used to decide between a save and an update prompt. */
export interface ExistingLogin {
  loginId: string
  /** Whether the saved password equals the submitted one; undefined when the backend cannot tell without asking the user. */
  samePassword: boolean | undefined
}

export interface ListOptions {
  /**
   * A lookup the user did not ask for, such as the toolbar's count of logins; it does not count as
   * use, so accounts still lock when idle.
   */
  passive?: boolean
}

export interface PasswordBackend {
  readonly kind: BackendKind
  sources(): Promise<SourceInfo[]>
  logins(
    sourceId: string,
    page: URL,
    options?: ListOptions,
  ): Promise<LoginSummary[]>
  /**
   * Logins whose name, username or address contain every word of the query, from the whole
   * vault. A backend that can only look up a site answers a query that is a host name.
   */
  search(sourceId: string, query: string): Promise<LoginSummary[]>
  /**
   * Reads one login's password; may ask the user to authenticate. `page` is the page the login is
   * read for, which it must match. Null is for a login the user picked in Keyward's own views from
   * the whole vault, as from a search; what is read that way never goes into a page.
   */
  credential(
    sourceId: string,
    loginId: string,
    page: URL | null,
    tab: TabRef,
  ): Promise<Credential>
  /** Describes one login; `page` as for `credential`. */
  details(
    sourceId: string,
    loginId: string,
    page: URL | null,
  ): Promise<LoginDetails>
  /** Logins of the page that give one-time codes. */
  codeLogins(sourceId: string, page: URL, tab: TabRef): Promise<LoginSummary[]>
  /** The current one-time code of a login; may ask the user to authenticate. `page` as for `credential`. */
  oneTimeCode(
    sourceId: string,
    loginId: string,
    page: URL | null,
    tab: TabRef,
  ): Promise<OneTimeCode>
  /** A login's fields for an edit form; only backends whose details say `editable` have it. */
  editable?(sourceId: string, loginId: string): Promise<EditableLogin>
  edit?(sourceId: string, loginId: string, change: LoginEdit): Promise<void>
  /** Moves a login to the trash, where the backend's own apps can restore it. */
  remove?(sourceId: string, loginId: string): Promise<void>
  /** Whether the backend can store a login for this address; a save prompt offers only those that can. */
  canSave(url: URL): boolean
  save(sourceId: string, login: NewLogin, tab: TabRef): Promise<void>
  update(
    sourceId: string,
    loginId: string,
    login: NewLogin,
    tab: TabRef,
  ): Promise<void>
  findExisting(
    sourceId: string,
    page: URL,
    username: string,
    password: string,
  ): Promise<ExistingLogin | null>
  /** Locks one source; it needs pairing or unlocking again before use. */
  lock(sourceId: string): Promise<void>
  lockAll(): Promise<void>
}

export class BackendError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
  }
}

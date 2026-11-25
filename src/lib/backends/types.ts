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
  /** Reads one login's password; may ask the user to authenticate. */
  credential(
    sourceId: string,
    loginId: string,
    page: URL,
    tab: TabRef,
  ): Promise<Credential>
  /** Describes one login of the page; the login must match the page as for `credential`. */
  details(sourceId: string, loginId: string, page: URL): Promise<LoginDetails>
  /** Logins of the page that give one-time codes. */
  codeLogins(sourceId: string, page: URL, tab: TabRef): Promise<LoginSummary[]>
  /** The current one-time code of a login; may ask the user to authenticate. */
  oneTimeCode(
    sourceId: string,
    loginId: string,
    page: URL,
    tab: TabRef,
  ): Promise<OneTimeCode>
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

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
  /** Shown as the section title: "Apple 密码" or an account's email address. */
  label: string
  /** Secondary text such as the server address. */
  detail?: string
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

export interface PasswordBackend {
  readonly kind: BackendKind
  sources(): Promise<SourceInfo[]>
  logins(sourceId: string, page: URL): Promise<LoginSummary[]>
  /** Reads one login's password; may ask the user to authenticate. */
  credential(
    sourceId: string,
    loginId: string,
    page: URL,
    tab: TabRef,
  ): Promise<Credential>
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

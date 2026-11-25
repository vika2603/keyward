/**
 * The contract every password provider implements. The popup, the in-page menu and the save prompt
 * only use this interface, so adding a password manager means adding one implementation and its
 * connect screen. A provider exposes one or more vaults: Apple Passwords is one vault, each
 * signed-in Bitwarden account is another.
 */

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
  /** Whether the login is known to give one-time codes; Apple tells only when asked for codes. */
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
}

/** A custom field to fill: text for a text field, or the state of a check box. */
export type FillField =
  | { name: string; text: string }
  | { name: string; checked: boolean }

/** Where a request comes from, passed through to providers that report it to their host. */
export interface TabRef {
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
}

export interface ListOptions {
  /**
   * A lookup the user did not ask for, such as the toolbar's count of logins; it does not count as
   * use, so accounts still lock when idle.
   */
  passive?: boolean
}

export interface VaultProvider {
  readonly kind: ProviderKind
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
   * Reads one login's password; may ask the user to authenticate. `page` is the page the login is
   * read for, which it must match. Null is for a login the user picked in Keyward's own views from
   * the whole vault, as from a search; what is read that way never goes into a page.
   */
  credential(
    vaultId: string,
    loginId: string,
    page: URL | null,
    tab: TabRef,
  ): Promise<Credential>
  /** Describes one login; `page` as for `credential`. */
  details(
    vaultId: string,
    loginId: string,
    page: URL | null,
  ): Promise<LoginDetails>
  /** Logins of the page that give one-time codes. */
  codeLogins(vaultId: string, page: URL, tab: TabRef): Promise<LoginSummary[]>
  /** The current one-time code of a login; may ask the user to authenticate. `page` as for `credential`. */
  oneTimeCode(
    vaultId: string,
    loginId: string,
    page: URL | null,
    tab: TabRef,
  ): Promise<OneTimeCode>
  /** Earlier passwords of a login, newest first; only providers whose details count them have it. */
  passwordHistory?(vaultId: string, loginId: string): Promise<PastPassword[]>
  /** Every login and note of a vault; only providers that can list a whole vault have it. */
  allItems?(vaultId: string): Promise<{
    logins: LoginSummary[]
    notes: NoteSummary[]
    groups?: VaultGroups
  }>
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
  remove?(vaultId: string, loginId: string): Promise<void>
  /** The folders new items can be filed in; only providers with folders have these. */
  folders?(vaultId: string): Promise<Folder[]>
  /** Stars a login or note, or takes its star away. */
  setFavorite?(
    vaultId: string,
    itemId: string,
    favorite: boolean,
  ): Promise<void>
  /** Whether the provider can store a login for this address; a save prompt offers only those that can. */
  canSave(url: URL): boolean
  /** Whether the user told the provider never to save logins for the page's site; a save prompt leaves it out. */
  refusesSaving?(vaultId: string, page: URL): Promise<boolean>
  save(vaultId: string, login: NewLogin, tab: TabRef): Promise<void>
  update(
    vaultId: string,
    loginId: string,
    login: NewLogin,
    tab: TabRef,
  ): Promise<void>
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

export class VaultError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
  }
}

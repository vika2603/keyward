/** Bitwarden's numbers for the kinds of items and fields, as its API sends and takes them. */

export const CIPHER_TYPE_LOGIN = 1
export const CIPHER_TYPE_SECURE_NOTE = 2
/** The only kind of secure note Bitwarden has. */
export const SECURE_NOTE_TYPE_GENERIC = 0

export const FIELD_TEXT = 0
export const FIELD_HIDDEN = 1
export const FIELD_BOOLEAN = 2
export const FIELD_LINKED = 3
/** The login fields a linked field can stand for. */
export const LINKED_USERNAME = 100
export const LINKED_PASSWORD = 101

/** Whether an item asks for the master password again before its secrets are shown. */
export const REPROMPT_NONE = 0
export const REPROMPT_PASSWORD = 1

/** How many earlier passwords Bitwarden's apps keep for an item. */
export const MAX_PASSWORD_HISTORY = 5

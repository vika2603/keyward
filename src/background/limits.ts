/**
 * The longest values the background accepts from its pages and content scripts. A longer value is
 * refused as invalid input rather than stored or passed on to a vault.
 */

/** IDs, names, usernames and passwords. */
export const MAX_TEXT_LENGTH = 1024
/** A web address, as the add view's site field and a login's websites take it. */
export const MAX_URL_LENGTH = 2048
/** A host name, as DNS limits it. */
export const MAX_HOST_LENGTH = 253
/** Bitwarden stores up to 10,000 characters of notes. */
export const MAX_NOTE_LENGTH = 10_000
/** An authenticator key, which may be a whole otpauth address. */
export const MAX_TOTP_LENGTH = 4096
export const MAX_CUSTOM_FIELD_VALUE_LENGTH = 5000
export const MAX_FOLDER_ID_LENGTH = 64
export const MAX_SEARCH_LENGTH = 256
export const MAX_COPIED_TEXT_LENGTH = 8192
/** A two-step login's code, from an authenticator, an email or a security key. */
export const MAX_SECOND_STEP_CODE_LENGTH = 128
export const MAX_ACCOUNT_NAME_LENGTH = 100
export const MAX_WEBSITES = 50
export const MAX_CUSTOM_FIELDS = 100

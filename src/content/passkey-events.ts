/**
 * Events between the content script and the page-world script that holds a page's passkey
 * request for Keyward's menu. Both go through `document` with a string `detail`. The page can see
 * and send them as well, which gives it nothing beyond what it can do with the WebAuthn API itself:
 * no credential or secret passes through them.
 */

/** Sent by the page-world script: "waiting" while it holds a request for the menu, else "none". */
export const PASSKEY_STATE_EVENT = "keyward:passkey-state"

/**
 * Sent by the content script: "hold" keeps a request for the menu, "release" hands it to the
 * browser's own passkey list, and "use" asks the browser to sign in with it now.
 */
export const PASSKEY_CONTROL_EVENT = "keyward:passkey-control"

export type PasskeyControl = "hold" | "release" | "use"

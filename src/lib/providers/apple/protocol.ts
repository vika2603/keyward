import { concat, fromUtf8, randomBytes, utf8 } from "@/lib/bytes"
import { type BinaryCodec, sameSessionId } from "./srp"

/** Command numbers of the helper's native messaging protocol. */
export const Cmd = {
  End: 0,
  Handshake: 2,
  GetLoginNamesForUrl: 4,
  GetPasswordForLoginName: 5,
  SetPasswordForLoginNameAndUrl: 6,
  TabEvent: 8,
  PasswordsDisabled: 9,
  ReloginNeeded: 10,
  LaunchPasswordsApp: 13,
  Hello: 14,
  /** Sent by the helper when the verification codes it offers have changed. */
  OneTimeCodeAvailable: 15,
  GetOneTimeCodes: 16,
  /** Despite its name, asks for the current code of an authenticator entry; the reply carries it. */
  DidFillOneTimeCode: 17,
  /** Ends a pairing that waits for its code and closes the window that shows the code on the Mac. */
  DidCancelPINPairing: 19,
} as const

export const Action = {
  Search: 2,
  MaybeAdd: 4,
  GhostSearch: 5,
} as const

export const QueryStatus = {
  Success: 0,
  GenericError: 1,
  InvalidParam: 2,
  NoResults: 3,
  FailedToDelete: 4,
  FailedToUpdate: 5,
  InvalidMessageFormat: 6,
  DuplicateItem: 7,
  UnknownAction: 8,
  InvalidSession: 9,
} as const

export interface HelperCapabilities {
  shouldUseBase64?: boolean
  secretSessionVersion?: number
  canSaveAccountWithEmptyUserName?: boolean
  canOpenPasswordsAppToNewPasswordSheet?: boolean
  canFillOneTimeCodes?: boolean
  /** The Passwords app can set up a verification code from an `otpauth://` URI. */
  scanForOTPURI?: boolean
  operatingSystem?: {
    name?: string
    majorVersion?: number
    minorVersion?: number
  }
}

export function encodePake(message: object): string {
  return utf8(JSON.stringify(message)).toBase64()
}

export function decodePake(pake: unknown): Record<string, unknown> {
  if (typeof pake !== "string") throw new Error("Missing PAKE payload")
  return JSON.parse(fromUtf8(Uint8Array.fromBase64(pake)))
}

// Lengths in bytes.
const AES_128_KEY_LENGTH = 16
const IV_LENGTH = 16

/** An established session: AES-128-GCM with the first 16 bytes of the SRP session key. */
export class SecureSession {
  private constructor(
    readonly id: string,
    readonly codec: BinaryCodec,
    private readonly key: CryptoKey,
  ) {}

  static async create(id: string, codec: BinaryCodec, sessionKey: Uint8Array) {
    const rawKey = sessionKey.slice(0, AES_128_KEY_LENGTH)
    const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ])
    return new SecureSession(id, codec, key)
  }

  /** Encrypts a query into the SMSG string the helper expects. Outgoing data is ciphertext, tag, IV. */
  async seal(message: object): Promise<string> {
    const iv = randomBytes(IV_LENGTH)
    const sealed = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        this.key,
        utf8(JSON.stringify(message)),
      ),
    )
    return JSON.stringify({
      TID: this.id,
      SDATA: this.codec.encode(concat(sealed, iv), false),
    })
  }

  /** Decrypts a reply. Incoming data is IV, ciphertext, tag. */
  async open(smsg: unknown): Promise<Record<string, unknown>> {
    const parsed = typeof smsg === "string" ? JSON.parse(smsg) : smsg
    if (!parsed || typeof parsed !== "object") throw new Error("Missing SMSG")
    const { TID, SDATA } = parsed as { TID?: unknown; SDATA?: unknown }
    if (typeof TID !== "string" || typeof SDATA !== "string")
      throw new Error("Malformed SMSG")
    if (!sameSessionId(this.codec, this.id, TID)) {
      throw new Error("Reply belongs to another session")
    }
    const data = this.codec.decode(SDATA)
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: data.slice(0, IV_LENGTH) },
      this.key,
      data.slice(IV_LENGTH),
    )
    return JSON.parse(fromUtf8(new Uint8Array(plain)))
  }
}

/** The entry listed for a site whose passwords are never saved; its words are joined by no-break spaces. */
const NEVER_SAVED = "Passwords not saved"

/** Whether a listed entry says the user chose never to save passwords for the site. */
export function isNeverSavedEntry(entry: Record<string, unknown>): boolean {
  return (
    typeof entry.USR === "string" &&
    entry.USR.replace(/\s/g, " ") === NEVER_SAVED
  )
}

/**
 * Whether a listed entry is a login. Listings mark every login alike, including one with only a
 * passkey, so logins without a password cannot be told apart here.
 */
export function isLoginEntry(entry: Record<string, unknown>): boolean {
  return typeof entry.USR === "string" && !isNeverSavedEntry(entry)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Login entries of a query reply; older helpers list them as `Entry_<n>` keys instead of `Entries`. */
export function entriesOf(
  reply: Record<string, unknown>,
): Record<string, unknown>[] {
  const listed = Array.isArray(reply.Entries)
    ? reply.Entries
    : Object.entries(reply)
        .filter(([key]) => key.startsWith("Entry_"))
        .sort(([first], [second]) => first.localeCompare(second))
        .map(([, value]) => value)
  return listed.filter(isRecord)
}

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
  operatingSystem?: {
    name?: string
    majorVersion?: number
    minorVersion?: number
  }
  [key: string]: unknown
}

export function encodePake(message: object): string {
  return utf8(JSON.stringify(message)).toBase64()
}

export function decodePake(pake: unknown): Record<string, unknown> {
  if (typeof pake !== "string") throw new Error("Missing PAKE payload")
  return JSON.parse(fromUtf8(Uint8Array.fromBase64(pake)))
}

const IV_LENGTH = 16

/** An established session: AES-128-GCM with the first 16 bytes of the SRP session key. */
export class SecureSession {
  private constructor(
    readonly id: string,
    readonly codec: BinaryCodec,
    private readonly key: CryptoKey,
  ) {}

  static async create(id: string, codec: BinaryCodec, sessionKey: Uint8Array) {
    const rawKey = sessionKey.slice(0, 16)
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

/** Login entries of a query reply; older helpers list them as `Entry_<n>` keys instead of `Entries`. */
export function entriesOf(
  reply: Record<string, unknown>,
): Record<string, unknown>[] {
  if (Array.isArray(reply.Entries)) return reply.Entries
  return Object.entries(reply)
    .filter(([key]) => key.startsWith("Entry_"))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, value]) => value as Record<string, unknown>)
}

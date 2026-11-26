import type { Kdf, PureCrypto } from "@bitwarden/sdk-internal"
import { VaultError } from "../types"

export const KdfType = { Pbkdf2Sha256: 0, Argon2id: 1 } as const

export interface KdfConfig {
  type: number
  iterations: number
  /** Argon2id memory in MiB. */
  memory?: number
  parallelism?: number
}

/**
 * The vault cryptography this extension needs, backed by the official SDK so that both the older
 * AES-CBC accounts and the newer COSE accounts work. Keys are opaque byte strings as the SDK
 * serializes them. Only this file and the loader touch the SDK.
 */
export interface VaultCrypto {
  /** The master key, used here only to compute the hash the server checks at sign-in. */
  deriveMasterKey(
    password: string,
    salt: string,
    kdf: KdfConfig,
  ): Uint8Array<ArrayBuffer>
  /** Decrypts the account's user key with the stretched master key (see {@link stretchMasterKey}). */
  unwrapUserKey(
    wrappedUserKey: string,
    stretchedMasterKey: Uint8Array,
  ): Uint8Array
  decryptString(encrypted: string, key: Uint8Array): string
  encryptString(plain: string, key: Uint8Array): string
  /** Unwraps a symmetric key, such as an item's own key, with another symmetric key. */
  unwrapKey(wrapped: string, key: Uint8Array): Uint8Array
  /** Unwraps the account's private key with the user key; returns PKCS #8 DER. */
  unwrapPrivateKey(wrapped: string, userKey: Uint8Array): Uint8Array
  /** Decrypts an organization key sent to the account's public key. */
  decapsulateKey(encapsulated: string, privateKey: Uint8Array): Uint8Array
}

export class WrongPasswordError extends VaultError {
  constructor() {
    super("The master password is incorrect", "bitwarden.wrongPassword")
  }
}

function toSdkKdf(kdf: KdfConfig): Kdf {
  if (kdf.type === KdfType.Pbkdf2Sha256)
    return { pBKDF2: { iterations: kdf.iterations } }
  if (kdf.type === KdfType.Argon2id && kdf.memory && kdf.parallelism) {
    return {
      argon2id: {
        iterations: kdf.iterations,
        memory: kdf.memory,
        parallelism: kdf.parallelism,
      },
    }
  }
  throw new Error(`Unsupported KDF settings (type ${kdf.type})`)
}

const encoder = new TextEncoder()

export function pureCryptoAdapter(sdk: typeof PureCrypto): VaultCrypto {
  return {
    deriveMasterKey: (password, salt, kdf) =>
      new Uint8Array(
        sdk.derive_kdf_material(
          encoder.encode(password),
          encoder.encode(salt),
          toSdkKdf(kdf),
        ),
      ),
    unwrapUserKey: (wrapped, stretchedMasterKey) => {
      try {
        return sdk.unwrap_symmetric_key(wrapped, stretchedMasterKey)
      } catch {
        throw new WrongPasswordError()
      }
    },
    decryptString: (encrypted, key) =>
      sdk.symmetric_decrypt_string(encrypted, key),
    encryptString: (plain, key) => sdk.symmetric_encrypt_string(plain, key),
    unwrapKey: (wrapped, key) => sdk.unwrap_symmetric_key(wrapped, key),
    unwrapPrivateKey: (wrapped, userKey) =>
      sdk.unwrap_decapsulation_key(wrapped, userKey),
    decapsulateKey: (encapsulated, privateKey) =>
      sdk.decapsulate_key_unsigned(encapsulated, privateKey),
  }
}

/** The salt of the master key: the server's when it sends one, otherwise the email address. */
export function masterKeySalt(
  email: string,
  serverSalt: string | null,
): string {
  return (serverSalt ?? email).trim().toLowerCase()
}

async function hmacSha256(
  key: Uint8Array<ArrayBuffer>,
  data: Uint8Array<ArrayBuffer>,
) {
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  return new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, data))
}

/**
 * Expands the master key into the 64-byte encryption and MAC key that wraps the user key: one
 * HKDF-Expand block each for "enc" and "mac". WebCrypto's HKDF always runs the extract step first,
 * so the expand step is written out.
 */
export async function stretchMasterKey(
  masterKey: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const block = (info: string) =>
    hmacSha256(masterKey, new Uint8Array([...encoder.encode(info), 1]))
  const [enc, mac] = await Promise.all([block("enc"), block("mac")])
  const out = new Uint8Array(64)
  out.set(enc)
  out.set(mac, 32)
  return out
}

/** The hash the server checks at sign-in: one PBKDF2-SHA256 round of the master key salted with the password. */
export async function masterPasswordHash(
  masterKey: Uint8Array<ArrayBuffer>,
  password: string,
): Promise<string> {
  const base = await crypto.subtle.importKey(
    "raw",
    masterKey,
    "PBKDF2",
    false,
    ["deriveBits"],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: encoder.encode(password),
      iterations: 1,
    },
    base,
    256,
  )
  return new Uint8Array(bits).toBase64()
}

import {
  bigIntToBytes,
  bytesEqual,
  bytesToBigInt,
  randomBytes,
  sha256,
  utf8,
} from "@/lib/bytes"

/**
 * The SRP-6a variant spoken by Apple's PasswordManagerBrowserExtensionHelper (protocol version 1,
 * "SRP with RFC verification"): the 3072-bit group of RFC 5054 with SHA-256, and the client and
 * server proofs of RFC 2945. Apple publishes no specification; the byte layouts below follow the
 * official Chrome extension, where integers are hashed as minimal big-endian bytes except where a
 * value is padded to the length of N.
 */
const N = BigInt(
  "0xFFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7EDEE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3BE39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA051015728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6BF12FFA06D98A0864D87602733EC86A64521F2B18177B200CBBE117577A615D6C770988C0BAD946E208E24FA074E5AB3143DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF",
)
const g = 5n
const N_LENGTH = 384

export const SRP_GROUP = { N, g, length: N_LENGTH } as const

export function modPow(
  base: bigint,
  exponent: bigint,
  modulus: bigint,
): bigint {
  let result = 1n
  let square = ((base % modulus) + modulus) % modulus
  let remaining = exponent
  while (remaining > 0n) {
    if (remaining & 1n) result = (result * square) % modulus
    square = (square * square) % modulus
    remaining >>= 1n
  }
  return result
}

/** How the helper encodes binary values in JSON, chosen by its `shouldUseBase64` capability. */
export class BinaryCodec {
  constructor(readonly base64: boolean) {}

  encode(bytes: Uint8Array, hexPrefix = true): string {
    if (this.base64) return bytes.toBase64()
    return (hexPrefix ? "0x" : "") + bytes.toHex()
  }

  decode(text: string): Uint8Array<ArrayBuffer> {
    if (this.base64) return Uint8Array.fromBase64(text)
    const hex = text.replace(/^0x/i, "").replace(/\s/g, "")
    return Uint8Array.fromHex(hex.length % 2 ? `0${hex}` : hex)
  }
}

export interface SrpResult {
  /** Client proof M, sent to the helper. */
  proof: Uint8Array
  /** Expected server proof H(A | M | K). */
  serverProof: Uint8Array
  /** Session key K = H(S); its first 16 bytes are the AES-GCM key of the session. */
  sessionKey: Uint8Array
}

export class SrpClient {
  /** The SRP identity I, a random 128-bit number in the helper's encoding. Also the session ID. */
  readonly username: string
  readonly publicKey: bigint
  private readonly privateKey: bigint

  constructor(
    readonly codec: BinaryCodec,
    seed: { identity?: Uint8Array; privateKey?: Uint8Array } = {},
  ) {
    const identity = bytesToBigInt(seed.identity ?? randomBytes(16))
    this.username = codec.encode(bigIntToBytes(identity))
    this.privateKey = bytesToBigInt(seed.privateKey ?? randomBytes(32))
    this.publicKey = modPow(g, this.privateKey, N)
  }

  async computeProof(
    salt: Uint8Array,
    serverPublicKey: bigint,
    pin: string,
  ): Promise<SrpResult> {
    const B = serverPublicKey
    if (B % N === 0n) throw new Error("Invalid server public key")
    const A = this.publicKey

    const x = bytesToBigInt(
      await sha256(salt, await sha256(utf8(`${this.username}:${pin}`))),
    )
    const u = bytesToBigInt(
      await sha256(bigIntToBytes(A, N_LENGTH), bigIntToBytes(B, N_LENGTH)),
    )
    const k = bytesToBigInt(
      await sha256(bigIntToBytes(N), bigIntToBytes(g, N_LENGTH)),
    )
    const v = modPow(g, x, N)
    const S = modPow(B - k * v, this.privateKey + u * x, N)
    const K = await sha256(bigIntToBytes(S))

    const hN = await sha256(bigIntToBytes(N))
    const hg = await sha256(bigIntToBytes(g, N_LENGTH))
    const hNxorHg = hN.map((byte, index) => byte ^ (hg[index] as number))
    const M = await sha256(
      hNxorHg,
      await sha256(utf8(this.username)),
      salt,
      bigIntToBytes(A),
      bigIntToBytes(B),
      K,
    )
    const HAMK = await sha256(bigIntToBytes(A), M, K)
    return { proof: M, serverProof: HAMK, sessionKey: K }
  }
}

/** Session IDs are numbers; the helper may encode the same number with different padding. */
export function sameSessionId(
  codec: BinaryCodec,
  first: string,
  second: string,
): boolean {
  return (
    bytesToBigInt(codec.decode(first)) === bytesToBigInt(codec.decode(second))
  )
}

export function verifyServerProof(
  result: SrpResult,
  received: Uint8Array,
): boolean {
  // Compared as numbers, so an encoding that drops leading zero bytes still matches.
  return bytesEqual(
    bigIntToBytes(bytesToBigInt(result.serverProof)),
    bigIntToBytes(bytesToBigInt(received)),
  )
}

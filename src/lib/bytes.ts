const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function utf8(text: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(text)
}

export function fromUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes)
}

export function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length))
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number)
  return diff === 0
}

export function bytesToBigInt(bytes: Uint8Array): bigint {
  let n = 0n
  for (const byte of bytes) n = (n << 8n) | BigInt(byte)
  return n
}

/** Big-endian bytes of a non-negative integer: the minimal length, or left-padded to `length`. */
export function bigIntToBytes(
  n: bigint,
  length?: number,
): Uint8Array<ArrayBuffer> {
  const hex = n.toString(16)
  const minimal = Uint8Array.fromHex(hex.length % 2 ? `0${hex}` : hex)
  if (length === undefined || minimal.length >= length) return minimal
  const out = new Uint8Array(length)
  out.set(minimal, length - minimal.length)
  return out
}

export async function sha256(
  ...parts: Uint8Array[]
): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", concat(...parts)))
}

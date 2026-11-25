const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function utf8(text: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(text)
}

export function fromUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes)
}

export function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(
    parts.reduce((total, part) => total + part.length, 0),
  )
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

export function bytesEqual(first: Uint8Array, second: Uint8Array): boolean {
  if (first.length !== second.length) return false
  let diff = 0
  for (let index = 0; index < first.length; index++)
    diff |= (first[index] as number) ^ (second[index] as number)
  return diff === 0
}

export function bytesToBigInt(bytes: Uint8Array): bigint {
  let value = 0n
  for (const byte of bytes) value = (value << 8n) | BigInt(byte)
  return value
}

/** Big-endian bytes of a non-negative integer: the minimal length, or left-padded to `length`. */
export function bigIntToBytes(
  value: bigint,
  length?: number,
): Uint8Array<ArrayBuffer> {
  const hex = value.toString(16)
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

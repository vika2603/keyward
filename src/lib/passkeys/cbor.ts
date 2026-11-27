/**
 * Minimal deterministic RFC 8949 / CTAP2 canonical CBOR encoder and decoder.
 * Supports unsigned/negative integers, byte strings, UTF-8 text strings,
 * arrays, maps (Map or plain object), booleans, and null — everything needed
 * for WebAuthn COSE public keys and attestationObject encoding/decoding.
 */

export type CborValue =
  | number
  | boolean
  | null
  | string
  | Uint8Array
  | CborValue[]
  | Map<number | string, CborValue>
  | { [key: string]: CborValue }

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function writeHead(out: number[], major: number, value: number): void {
  const high = major << 5
  if (value < 24) {
    out.push(high | value)
  } else if (value < 0x100) {
    out.push(high | 24, value)
  } else if (value < 0x10000) {
    out.push(high | 25, (value >>> 8) & 0xff, value & 0xff)
  } else if (value < 0x100000000) {
    out.push(
      high | 26,
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    )
  } else {
    const hi = Math.floor(value / 0x100000000)
    const lo = value >>> 0
    out.push(
      high | 27,
      (hi >>> 24) & 0xff,
      (hi >>> 16) & 0xff,
      (hi >>> 8) & 0xff,
      hi & 0xff,
      (lo >>> 24) & 0xff,
      (lo >>> 16) & 0xff,
      (lo >>> 8) & 0xff,
      lo & 0xff,
    )
  }
}

/** CTAP2 canonical map key ordering: shorter encoded key first, then bytewise lexicographical. */
function compareBytes(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) return a.length - b.length
  for (let i = 0; i < a.length; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

function encodeInto(out: number[], value: CborValue): void {
  if (value === null) {
    out.push(0xf6)
    return
  }
  if (typeof value === "boolean") {
    out.push(value ? 0xf5 : 0xf4)
    return
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value))
      throw new Error(`CBOR only supports safe integers, got ${value}`)
    if (value >= 0) writeHead(out, 0, value)
    else writeHead(out, 1, -1 - value)
    return
  }
  if (typeof value === "string") {
    const bytes = encoder.encode(value)
    writeHead(out, 3, bytes.length)
    for (const b of bytes) out.push(b)
    return
  }
  if (value instanceof Uint8Array) {
    writeHead(out, 2, value.length)
    for (const b of value) out.push(b)
    return
  }
  if (Array.isArray(value)) {
    writeHead(out, 4, value.length)
    for (const item of value) encodeInto(out, item)
    return
  }
  const entries: [Uint8Array, CborValue][] =
    value instanceof Map
      ? Array.from(value.entries(), ([k, v]) => [cborEncode(k), v])
      : Object.entries(value).map(([k, v]) => [cborEncode(k), v])
  entries.sort((a, b) => compareBytes(a[0], b[0]))
  writeHead(out, 5, entries.length)
  for (const [encodedKey, v] of entries) {
    for (const b of encodedKey) out.push(b)
    encodeInto(out, v)
  }
}

export function cborEncode(value: CborValue): Uint8Array {
  const out: number[] = []
  encodeInto(out, value)
  return new Uint8Array(out)
}

interface Reader {
  bytes: Uint8Array
  offset: number
}

function readUint(r: Reader, info: number): number {
  if (info < 24) return info
  if (info === 24) {
    if (r.offset + 1 > r.bytes.length) throw new Error("Truncated CBOR uint8")
    return r.bytes[r.offset++] ?? 0
  }
  if (info === 25) {
    if (r.offset + 2 > r.bytes.length) throw new Error("Truncated CBOR uint16")
    const val = ((r.bytes[r.offset] ?? 0) << 8) | (r.bytes[r.offset + 1] ?? 0)
    r.offset += 2
    return val
  }
  if (info === 26) {
    if (r.offset + 4 > r.bytes.length) throw new Error("Truncated CBOR uint32")
    const val =
      (r.bytes[r.offset] ?? 0) * 0x1000000 +
      (((r.bytes[r.offset + 1] ?? 0) << 16) |
        ((r.bytes[r.offset + 2] ?? 0) << 8) |
        (r.bytes[r.offset + 3] ?? 0))
    r.offset += 4
    return val
  }
  if (info === 27) {
    if (r.offset + 8 > r.bytes.length) throw new Error("Truncated CBOR uint64")
    const hi =
      (r.bytes[r.offset] ?? 0) * 0x1000000 +
      (((r.bytes[r.offset + 1] ?? 0) << 16) |
        ((r.bytes[r.offset + 2] ?? 0) << 8) |
        (r.bytes[r.offset + 3] ?? 0))
    const lo =
      (r.bytes[r.offset + 4] ?? 0) * 0x1000000 +
      (((r.bytes[r.offset + 5] ?? 0) << 16) |
        ((r.bytes[r.offset + 6] ?? 0) << 8) |
        (r.bytes[r.offset + 7] ?? 0))
    r.offset += 8
    return hi * 0x100000000 + lo
  }
  throw new Error(`Unsupported CBOR additional info ${info}`)
}

function decodeNext(r: Reader): CborValue {
  if (r.offset >= r.bytes.length) throw new Error("Unexpected end of CBOR data")
  const initial = r.bytes[r.offset++] ?? 0
  const major = initial >>> 5
  const info = initial & 0x1f

  switch (major) {
    case 0:
      return readUint(r, info)
    case 1:
      return -1 - readUint(r, info)
    case 2: {
      const length = readUint(r, info)
      if (r.offset + length > r.bytes.length)
        throw new Error("Truncated CBOR byte string")
      const slice = r.bytes.slice(r.offset, r.offset + length)
      r.offset += length
      return slice
    }
    case 3: {
      const length = readUint(r, info)
      if (r.offset + length > r.bytes.length)
        throw new Error("Truncated CBOR text string")
      const slice = r.bytes.subarray(r.offset, r.offset + length)
      r.offset += length
      return decoder.decode(slice)
    }
    case 4: {
      const length = readUint(r, info)
      const items: CborValue[] = []
      for (let i = 0; i < length; i++) items.push(decodeNext(r))
      return items
    }
    case 5: {
      const length = readUint(r, info)
      const map = new Map<number | string, CborValue>()
      for (let i = 0; i < length; i++) {
        const key = decodeNext(r)
        if (typeof key !== "number" && typeof key !== "string")
          throw new Error("Unsupported CBOR map key type")
        map.set(key, decodeNext(r))
      }
      return map
    }
    case 7:
      if (info === 20) return false
      if (info === 21) return true
      if (info === 22) return null
      throw new Error(`Unsupported CBOR simple value ${info}`)
    default:
      throw new Error(`Unsupported CBOR major type ${major}`)
  }
}

export function cborDecode(bytes: Uint8Array): CborValue {
  const reader: Reader = { bytes, offset: 0 }
  const value = decodeNext(reader)
  if (reader.offset !== bytes.length)
    throw new Error("Trailing bytes after CBOR value")
  return value
}

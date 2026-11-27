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

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

const UINT32_MODULO = 0x100000000

function writeHead(output: number[], majorType: number, value: number): void {
  const prefix = majorType << 5
  if (value < 24) {
    output.push(prefix | value)
  } else if (value < 0x100) {
    output.push(prefix | 24, value)
  } else if (value < 0x10000) {
    output.push(prefix | 25, (value >>> 8) & 0xff, value & 0xff)
  } else if (value < UINT32_MODULO) {
    output.push(
      prefix | 26,
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    )
  } else {
    const high = Math.floor(value / UINT32_MODULO)
    const low = value >>> 0
    output.push(
      prefix | 27,
      (high >>> 24) & 0xff,
      (high >>> 16) & 0xff,
      (high >>> 8) & 0xff,
      high & 0xff,
      (low >>> 24) & 0xff,
      (low >>> 16) & 0xff,
      (low >>> 8) & 0xff,
      low & 0xff,
    )
  }
}

/** CTAP2 canonical map key order: shorter encoded key first, then bytewise lexicographical. */
function compareCanonicalKeys(first: Uint8Array, second: Uint8Array): number {
  if (first.length !== second.length) return first.length - second.length
  for (let index = 0; index < first.length; index++) {
    const diff = (first[index] ?? 0) - (second[index] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

function encodeInto(output: number[], value: CborValue): void {
  if (value === null) {
    output.push(0xf6)
    return
  }
  if (typeof value === "boolean") {
    output.push(value ? 0xf5 : 0xf4)
    return
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value))
      throw new Error(`CBOR only supports safe integers, got ${value}`)
    if (value >= 0) writeHead(output, 0, value)
    else writeHead(output, 1, -1 - value)
    return
  }
  if (typeof value === "string") {
    const encoded = textEncoder.encode(value)
    writeHead(output, 3, encoded.length)
    for (const byte of encoded) output.push(byte)
    return
  }
  if (value instanceof Uint8Array) {
    writeHead(output, 2, value.length)
    for (const byte of value) output.push(byte)
    return
  }
  if (Array.isArray(value)) {
    writeHead(output, 4, value.length)
    for (const item of value) encodeInto(output, item)
    return
  }

  const encodedEntries: [Uint8Array, CborValue][] =
    value instanceof Map
      ? Array.from(value.entries(), ([key, entryValue]) => [
          cborEncode(key),
          entryValue,
        ])
      : Object.entries(value).map(([key, entryValue]) => [
          cborEncode(key),
          entryValue,
        ])
  encodedEntries.sort(([firstKey], [secondKey]) =>
    compareCanonicalKeys(firstKey, secondKey),
  )

  writeHead(output, 5, encodedEntries.length)
  for (const [encodedKey, entryValue] of encodedEntries) {
    for (const byte of encodedKey) output.push(byte)
    encodeInto(output, entryValue)
  }
}

export function cborEncode(value: CborValue): Uint8Array {
  const output: number[] = []
  encodeInto(output, value)
  return new Uint8Array(output)
}

interface CborReader {
  readonly bytes: Uint8Array
  offset: number
}

function readBytes(reader: CborReader, length: number): Uint8Array {
  if (reader.offset + length > reader.bytes.length)
    throw new Error("Truncated CBOR input")
  const slice = reader.bytes.subarray(reader.offset, reader.offset + length)
  reader.offset += length
  return slice
}

function readUint32(reader: CborReader): number {
  const chunk = readBytes(reader, 4)
  return new DataView(chunk.buffer, chunk.byteOffset, 4).getUint32(0, false)
}

function readUint(reader: CborReader, additionalInfo: number): number {
  if (additionalInfo < 24) return additionalInfo
  if (additionalInfo === 24) return readBytes(reader, 1)[0] ?? 0
  if (additionalInfo === 25) {
    const chunk = readBytes(reader, 2)
    return new DataView(chunk.buffer, chunk.byteOffset, 2).getUint16(0, false)
  }
  if (additionalInfo === 26) return readUint32(reader)
  if (additionalInfo === 27) {
    const high = readUint32(reader)
    const low = readUint32(reader)
    return high * UINT32_MODULO + low
  }
  throw new Error(`Unsupported CBOR additional info ${additionalInfo}`)
}

function decodeNext(reader: CborReader): CborValue {
  const initialByte = readBytes(reader, 1)[0] ?? 0
  const majorType = initialByte >>> 5
  const additionalInfo = initialByte & 0x1f

  switch (majorType) {
    case 0:
      return readUint(reader, additionalInfo)
    case 1:
      return -1 - readUint(reader, additionalInfo)
    case 2: {
      const length = readUint(reader, additionalInfo)
      return readBytes(reader, length).slice()
    }
    case 3: {
      const length = readUint(reader, additionalInfo)
      return textDecoder.decode(readBytes(reader, length))
    }
    case 4: {
      const length = readUint(reader, additionalInfo)
      const items: CborValue[] = []
      for (let index = 0; index < length; index++)
        items.push(decodeNext(reader))
      return items
    }
    case 5: {
      const length = readUint(reader, additionalInfo)
      const map = new Map<number | string, CborValue>()
      for (let index = 0; index < length; index++) {
        const key = decodeNext(reader)
        if (typeof key !== "number" && typeof key !== "string")
          throw new Error("Unsupported CBOR map key type")
        map.set(key, decodeNext(reader))
      }
      return map
    }
    case 7:
      if (additionalInfo === 20) return false
      if (additionalInfo === 21) return true
      if (additionalInfo === 22) return null
      throw new Error(`Unsupported CBOR simple value ${additionalInfo}`)
    default:
      throw new Error(`Unsupported CBOR major type ${majorType}`)
  }
}

export function cborDecode(bytes: Uint8Array): CborValue {
  const reader: CborReader = { bytes, offset: 0 }
  const value = decodeNext(reader)
  if (reader.offset !== bytes.length)
    throw new Error("Trailing bytes after CBOR value")
  return value
}

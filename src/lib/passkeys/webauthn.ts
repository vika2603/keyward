import { getDomain } from "tldts"
import { parseUrl } from "@/lib/site"
import { cborEncode } from "./cbor"
import type {
  PasskeyCreateRequest,
  PasskeyGetRequest,
  SerializedCreateResult,
  SerializedGetResult,
  StoredPasskey,
} from "./types"

/** COSE algorithm identifier for ECDSA w/ SHA-256 on P-256. */
export const COSE_ALG_ES256 = -7
/** COSE key type for Elliptic Curve keys (x, y). */
const COSE_KTY_EC2 = 2
/** COSE curve identifier for NIST P-256. */
const COSE_CRV_P256 = 1

/** Authenticator data flags. */
const FLAG_UP = 0x01 // User Present
const FLAG_UV = 0x04 // User Verified
const FLAG_BE = 0x08 // Backup Eligibility (multi-device synced passkey)
const FLAG_BS = 0x10 // Backup State (backed up in Bitwarden vault)
const FLAG_AT = 0x40 // Attested Credential Data included

/** 16-byte all-zero AAGUID used for `fmt: "none"` software authenticators. */
const ZERO_AAGUID = new Uint8Array(16)

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function toBase64Url(bytes: Uint8Array): string {
  return bytes
    .toBase64()
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
}

export function fromBase64Url(input: string): Uint8Array<ArrayBuffer> {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/")
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4)
  const decoded = Uint8Array.fromBase64(padded)
  const out = new Uint8Array(new ArrayBuffer(decoded.length))
  out.set(decoded)
  return out
}

/** Converts a Bitwarden stored credentialId (UUID string or base64url) to raw WebAuthn credential ID bytes. */
export function credentialIdToBytes(credentialId: string): Uint8Array {
  if (UUID_PATTERN.test(credentialId)) {
    const hex = credentialId.replace(/-/g, "")
    const bytes = new Uint8Array(16)
    for (let i = 0; i < 16; i++)
      bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    return bytes
  }
  return fromBase64Url(credentialId)
}

/** Converts raw WebAuthn credential ID bytes into base64url for comparison with `allowCredentials`/`excludeCredentials`. */
export function credentialIdBase64Url(credentialId: string): string {
  return toBase64Url(credentialIdToBytes(credentialId))
}

function isLoopbackHost(host: string): boolean {
  const lower = host.toLowerCase()
  return (
    lower === "localhost" ||
    lower === "127.0.0.1" ||
    lower === "[::1]" ||
    lower === "::1"
  )
}

function isIpAddress(host: string): boolean {
  return (
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
    host.includes(":") ||
    host.startsWith("[")
  )
}

/**
 * Validates a WebAuthn RP ID against the requesting frame's origin per the WebAuthn specification:
 * - Origin must be HTTPS (or HTTP localhost for local development).
 * - RP ID must match the origin's hostname or be a registrable domain suffix of it (never a public suffix).
 */
export function isValidRpId(rpId: string, origin: string): boolean {
  const normalizedRp = rpId.trim().toLowerCase().replace(/\.$/, "")
  if (
    !normalizedRp ||
    normalizedRp.includes("://") ||
    normalizedRp.includes("/")
  )
    return false
  const parsed = parseUrl(origin)
  if (!parsed) return false
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "")
  if (!host) return false
  if (
    parsed.protocol !== "https:" &&
    !(parsed.protocol === "http:" && isLoopbackHost(host))
  )
    return false
  if (isIpAddress(normalizedRp))
    return normalizedRp === host && isLoopbackHost(host)
  if (normalizedRp === host) return true
  if (!host.endsWith(`.${normalizedRp}`)) return false
  // RP ID must not be a bare public suffix (e.g. "co.uk" or "com").
  const registrable = getDomain(normalizedRp, { allowPrivateDomains: true })
  return registrable !== null && normalizedRp.endsWith(registrable)
}

/** Converts a 64-byte IEEE P1363 ECDSA P-256 signature (r || s) into ASN.1 DER format required by WebAuthn. */
export function derSignatureFromP1363(raw: Uint8Array): Uint8Array {
  if (raw.length !== 64)
    throw new Error(`Expected 64-byte P-256 signature, got ${raw.length}`)
  const encodeInteger = (part: Uint8Array): number[] => {
    let start = 0
    while (start < part.length - 1 && part[start] === 0) start++
    const trimmed = part.subarray(start)
    const needsPad = (trimmed[0] ?? 0) >= 0x80
    const body = needsPad ? [0x00, ...trimmed] : [...trimmed]
    return [0x02, body.length, ...body]
  }
  const r = encodeInteger(raw.subarray(0, 32))
  const s = encodeInteger(raw.subarray(32, 64))
  return new Uint8Array([0x30, r.length + s.length, ...r, ...s])
}

/** Converts an ASN.1 DER ECDSA P-256 signature back to 64-byte IEEE P1363 (used for WebCrypto verification). */
export function p1363FromDerSignature(
  der: Uint8Array,
): Uint8Array<ArrayBuffer> {
  if (der[0] !== 0x30) throw new Error("Invalid DER signature sequence")
  let offset = 2
  const readPart = (): Uint8Array => {
    if (der[offset] !== 0x02) throw new Error("Invalid DER integer tag")
    const len = der[offset + 1] ?? 0
    offset += 2
    const slice = der.subarray(offset, offset + len)
    offset += len
    const out = new Uint8Array(32)
    if (slice.length > 32) {
      // Drop leading 0x00 sign byte(s).
      out.set(slice.subarray(slice.length - 32))
    } else {
      out.set(slice, 32 - slice.length)
    }
    return out
  }
  const r = readPart()
  const s = readPart()
  const out = new Uint8Array(new ArrayBuffer(64))
  out.set(r, 0)
  out.set(s, 32)
  return out
}

function uint32BE(value: number): Uint8Array {
  const buf = new Uint8Array(4)
  new DataView(buf.buffer).setUint32(0, value >>> 0, false)
  return buf
}

function uint16BE(value: number): Uint8Array {
  const buf = new Uint8Array(2)
  new DataView(buf.buffer).setUint16(0, value & 0xffff, false)
  return buf
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(new ArrayBuffer(total))
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

async function sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
  const copy = new Uint8Array(new ArrayBuffer(data.length))
  copy.set(data)
  return new Uint8Array(await crypto.subtle.digest("SHA-256", copy))
}

function clientDataBytes(
  type: "webauthn.create" | "webauthn.get",
  challenge: string,
  origin: string,
  crossOrigin: boolean,
): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      type,
      challenge,
      origin,
      crossOrigin,
    }),
  )
}

/**
 * Creates a new ECDSA P-256 passkey, returning both the Bitwarden `StoredPasskey` record
 * and the serialized `PublicKeyCredential` response for the page.
 */
export async function createPasskeyCredential(
  request: PasskeyCreateRequest,
): Promise<{ stored: StoredPasskey; credential: SerializedCreateResult }> {
  const rpId = request.rpId.trim().toLowerCase()
  if (!isValidRpId(rpId, request.origin))
    throw new DOMException(
      `RP ID "${rpId}" is not valid for origin ${request.origin}`,
      "SecurityError",
    )

  if (
    request.pubKeyCredParams.length > 0 &&
    !request.pubKeyCredParams.includes(COSE_ALG_ES256)
  ) {
    throw new DOMException(
      "Only ES256 (-7) public key credentials are supported",
      "NotSupportedError",
    )
  }

  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )

  const pkcs8 = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", keyPair.privateKey),
  )
  const spki = new Uint8Array(
    await crypto.subtle.exportKey("spki", keyPair.publicKey),
  )
  const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey)
  if (!jwk.x || !jwk.y)
    throw new Error("Failed to export ECDSA P-256 public key coordinates")

  const cosePublicKey = cborEncode(
    new Map<number, number | Uint8Array>([
      [1, COSE_KTY_EC2],
      [3, COSE_ALG_ES256],
      [-1, COSE_CRV_P256],
      [-2, fromBase64Url(jwk.x)],
      [-3, fromBase64Url(jwk.y)],
    ]),
  )

  // UUID format matches Bitwarden official clients' Fido2Credential.CredentialId convention.
  const credentialUuid = crypto.randomUUID()
  const credentialIdBytes = credentialIdToBytes(credentialUuid)
  const rpIdHash = await sha256Bytes(new TextEncoder().encode(rpId))
  const flags = new Uint8Array([
    FLAG_UP | FLAG_UV | FLAG_BE | FLAG_BS | FLAG_AT,
  ])
  const authData = concatBytes(
    rpIdHash,
    flags,
    uint32BE(0),
    ZERO_AAGUID,
    uint16BE(credentialIdBytes.length),
    credentialIdBytes,
    cosePublicKey,
  )

  const attestationObject = cborEncode({
    fmt: "none",
    attStmt: {},
    authData,
  })
  const clientData = clientDataBytes(
    "webauthn.create",
    request.challenge,
    request.origin,
    request.crossOrigin,
  )

  const rawIdB64Url = toBase64Url(credentialIdBytes)
  const discoverable = request.residentKey === "discouraged" ? "false" : "true"

  const stored: StoredPasskey = {
    credentialId: credentialUuid,
    keyType: "public-key",
    keyAlgorithm: "ECDSA",
    keyCurve: "P-256",
    keyValue: toBase64Url(pkcs8),
    rpId,
    rpName: request.rpName || rpId,
    userHandle: request.userId,
    userName: request.userName,
    userDisplayName: request.userDisplayName || request.userName,
    counter: "0",
    discoverable,
    creationDate: new Date().toISOString(),
  }

  return {
    stored,
    credential: {
      id: rawIdB64Url,
      rawId: rawIdB64Url,
      authenticatorAttachment: "platform",
      response: {
        clientDataJSON: toBase64Url(clientData),
        attestationObject: toBase64Url(attestationObject),
        authenticatorData: toBase64Url(authData),
        publicKey: toBase64Url(spki),
        publicKeyAlgorithm: COSE_ALG_ES256,
        transports: ["internal", "hybrid"],
      },
    },
  }
}

/**
 * Signs a WebAuthn assertion using a stored Bitwarden ECDSA P-256 passkey.
 */
export async function assertPasskeyCredential(
  passkey: StoredPasskey,
  request: PasskeyGetRequest,
): Promise<{ credential: SerializedGetResult; nextCounter: number }> {
  const rpId = request.rpId.trim().toLowerCase()
  if (!isValidRpId(rpId, request.origin))
    throw new DOMException(
      `RP ID "${rpId}" is not valid for origin ${request.origin}`,
      "SecurityError",
    )
  if (passkey.rpId.trim().toLowerCase() !== rpId)
    throw new DOMException("Passkey RP ID mismatch", "SecurityError")

  const pkcs8 = fromBase64Url(passkey.keyValue)
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  )

  const currentCounter = Number.parseInt(passkey.counter, 10)
  const nextCounter =
    Number.isFinite(currentCounter) && currentCounter > 0
      ? currentCounter + 1
      : 0

  const clientData = clientDataBytes(
    "webauthn.get",
    request.challenge,
    request.origin,
    request.crossOrigin,
  )
  const clientDataHash = await sha256Bytes(clientData)
  const rpIdHash = await sha256Bytes(new TextEncoder().encode(rpId))
  const flags = new Uint8Array([FLAG_UP | FLAG_UV | FLAG_BE | FLAG_BS])
  const authData = concatBytes(rpIdHash, flags, uint32BE(nextCounter))
  const signedPayload = concatBytes(authData, clientDataHash)

  const rawSignature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      privateKey,
      signedPayload,
    ),
  )
  const derSignature = derSignatureFromP1363(rawSignature)
  const rawIdB64Url = credentialIdBase64Url(passkey.credentialId)

  return {
    nextCounter,
    credential: {
      id: rawIdB64Url,
      rawId: rawIdB64Url,
      authenticatorAttachment: "platform",
      response: {
        clientDataJSON: toBase64Url(clientData),
        authenticatorData: toBase64Url(authData),
        signature: toBase64Url(derSignature),
        userHandle: passkey.userHandle || null,
      },
    },
  }
}

import { getDomain } from "tldts"
import { isLoopbackHost, parseUrl } from "@/lib/site"
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
const FLAG_USER_PRESENT = 0x01
const FLAG_USER_VERIFIED = 0x04
const FLAG_BACKUP_ELIGIBLE = 0x08
const FLAG_BACKUP_STATE = 0x10
const FLAG_ATTESTED_CREDENTIAL_DATA = 0x40

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
  const output = new Uint8Array(new ArrayBuffer(decoded.length))
  output.set(decoded)
  return output
}

/** Converts a Bitwarden stored credentialId (UUID string or base64url) to raw WebAuthn credential ID bytes. */
export function credentialIdToBytes(credentialId: string): Uint8Array {
  if (UUID_PATTERN.test(credentialId)) {
    const hex = credentialId.replace(/-/g, "")
    const bytes = new Uint8Array(16)
    for (let index = 0; index < 16; index++) {
      bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
    }
    return bytes
  }
  return fromBase64Url(credentialId)
}

/** Converts a stored credentialId into base64url for comparison with `allowCredentials`/`excludeCredentials`. */
export function credentialIdBase64Url(credentialId: string): string {
  return toBase64Url(credentialIdToBytes(credentialId))
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
 * - Origin must be HTTPS (or HTTP loopback for local development).
 * - RP ID must match the origin's hostname or be a registrable domain suffix of it (never a public suffix).
 */
export function isValidRpId(rpId: string, origin: string): boolean {
  const normalizedRpId = rpId.trim().toLowerCase().replace(/\.$/, "")
  const hasInvalidSyntax =
    !normalizedRpId ||
    normalizedRpId.includes("://") ||
    normalizedRpId.includes("/")
  if (hasInvalidSyntax) return false

  const parsedOrigin = parseUrl(origin)
  if (!parsedOrigin) return false
  const originHost = parsedOrigin.hostname.toLowerCase().replace(/\.$/, "")
  if (!originHost) return false

  const isHttps = parsedOrigin.protocol === "https:"
  const isLocalHttp =
    parsedOrigin.protocol === "http:" && isLoopbackHost(originHost)
  if (!isHttps && !isLocalHttp) return false

  if (isIpAddress(normalizedRpId)) {
    return normalizedRpId === originHost && isLoopbackHost(originHost)
  }
  if (normalizedRpId === originHost) return true
  if (!originHost.endsWith(`.${normalizedRpId}`)) return false

  // RP ID must not be a bare public suffix (e.g. "co.uk" or "com").
  const registrableDomain = getDomain(normalizedRpId, {
    allowPrivateDomains: true,
  })
  return (
    registrableDomain !== null && normalizedRpId.endsWith(registrableDomain)
  )
}

/** Converts a 64-byte IEEE P1363 ECDSA P-256 signature (r || s) into ASN.1 DER format required by WebAuthn. */
export function derSignatureFromP1363(rawSignature: Uint8Array): Uint8Array {
  if (rawSignature.length !== 64) {
    throw new Error(
      `Expected 64-byte P-256 signature, got ${rawSignature.length}`,
    )
  }
  const encodeDerInteger = (component: Uint8Array): number[] => {
    let start = 0
    while (start < component.length - 1 && component[start] === 0) start++
    const trimmed = component.subarray(start)
    const needsLeadingZero = (trimmed[0] ?? 0) >= 0x80
    const body = needsLeadingZero ? [0x00, ...trimmed] : [...trimmed]
    return [0x02, body.length, ...body]
  }
  const rEncoded = encodeDerInteger(rawSignature.subarray(0, 32))
  const sEncoded = encodeDerInteger(rawSignature.subarray(32, 64))
  return new Uint8Array([
    0x30,
    rEncoded.length + sEncoded.length,
    ...rEncoded,
    ...sEncoded,
  ])
}

/** Converts an ASN.1 DER ECDSA P-256 signature back to 64-byte IEEE P1363 (used for WebCrypto verification). */
export function p1363FromDerSignature(
  derSignature: Uint8Array,
): Uint8Array<ArrayBuffer> {
  if (derSignature[0] !== 0x30)
    throw new Error("Invalid DER signature sequence")
  let offset = 2
  const readComponent = (): Uint8Array => {
    if (derSignature[offset] !== 0x02)
      throw new Error("Invalid DER integer tag")
    const length = derSignature[offset + 1] ?? 0
    offset += 2
    const slice = derSignature.subarray(offset, offset + length)
    offset += length
    const component = new Uint8Array(32)
    if (slice.length > 32) {
      // Drop leading 0x00 sign padding byte(s).
      component.set(slice.subarray(slice.length - 32))
    } else {
      component.set(slice, 32 - slice.length)
    }
    return component
  }
  const rComponent = readComponent()
  const sComponent = readComponent()
  const output = new Uint8Array(new ArrayBuffer(64))
  output.set(rComponent, 0)
  output.set(sComponent, 32)
  return output
}

function uint32BE(value: number): Uint8Array {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value >>> 0, false)
  return bytes
}

function uint16BE(value: number): Uint8Array {
  const bytes = new Uint8Array(2)
  new DataView(bytes.buffer).setUint16(0, value & 0xffff, false)
  return bytes
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const output = new Uint8Array(new ArrayBuffer(totalLength))
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

async function sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
  const copy = new Uint8Array(new ArrayBuffer(data.length))
  copy.set(data)
  return new Uint8Array(await crypto.subtle.digest("SHA-256", copy))
}

function encodeClientData(
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
  if (!isValidRpId(rpId, request.origin)) {
    throw new DOMException(
      `RP ID "${rpId}" is not valid for origin ${request.origin}`,
      "SecurityError",
    )
  }

  const acceptsEs256 =
    request.pubKeyCredParams.length === 0 ||
    request.pubKeyCredParams.includes(COSE_ALG_ES256)
  if (!acceptsEs256) {
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
    FLAG_USER_PRESENT |
      FLAG_USER_VERIFIED |
      FLAG_BACKUP_ELIGIBLE |
      FLAG_BACKUP_STATE |
      FLAG_ATTESTED_CREDENTIAL_DATA,
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
  const clientData = encodeClientData(
    "webauthn.create",
    request.challenge,
    request.origin,
    request.crossOrigin,
  )

  const encodedCredentialId = toBase64Url(credentialIdBytes)
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
      id: encodedCredentialId,
      rawId: encodedCredentialId,
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

/** Signs a WebAuthn assertion using a stored Bitwarden ECDSA P-256 passkey. */
export async function assertPasskeyCredential(
  passkey: StoredPasskey,
  request: PasskeyGetRequest,
): Promise<{ credential: SerializedGetResult; nextCounter: number }> {
  const rpId = request.rpId.trim().toLowerCase()
  if (!isValidRpId(rpId, request.origin)) {
    throw new DOMException(
      `RP ID "${rpId}" is not valid for origin ${request.origin}`,
      "SecurityError",
    )
  }
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

  const clientData = encodeClientData(
    "webauthn.get",
    request.challenge,
    request.origin,
    request.crossOrigin,
  )
  const clientDataHash = await sha256Bytes(clientData)
  const rpIdHash = await sha256Bytes(new TextEncoder().encode(rpId))
  const flags = new Uint8Array([
    FLAG_USER_PRESENT |
      FLAG_USER_VERIFIED |
      FLAG_BACKUP_ELIGIBLE |
      FLAG_BACKUP_STATE,
  ])
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
  const encodedCredentialId = credentialIdBase64Url(passkey.credentialId)

  return {
    nextCounter,
    credential: {
      id: encodedCredentialId,
      rawId: encodedCredentialId,
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

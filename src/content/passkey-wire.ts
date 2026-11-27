import type {
  PasskeyCreateRequest,
  PasskeyDescriptor,
  PasskeyGetRequest,
  SerializedCreateResult,
  SerializedGetResult,
} from "@/lib/passkeys/types"

/**
 * Dependency-free WebAuthn wire serialization and PublicKeyCredential reconstruction helpers
 * used by the MAIN-world passkeys content script.
 */

export function bufferToBase64Url(source: BufferSource): string {
  const bytes =
    source instanceof ArrayBuffer
      ? new Uint8Array(source)
      : new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
}

export function base64UrlToBuffer(encoded: string): ArrayBuffer {
  const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/")
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes.buffer
}

function serializeDescriptors(
  descriptors: readonly PublicKeyCredentialDescriptor[] | undefined,
): PasskeyDescriptor[] {
  if (!descriptors?.length) return []
  return descriptors.map((descriptor) => ({
    type: "public-key",
    id: bufferToBase64Url(descriptor.id),
    ...(descriptor.transports
      ? { transports: [...descriptor.transports] }
      : {}),
  }))
}

function isCrossOriginFrame(): boolean {
  try {
    return window.top !== window && window.top?.origin !== window.origin
  } catch {
    return true
  }
}

export function isWebAuthnFeatureAllowed(feature: string): boolean {
  const policyDocument = document as Document & {
    permissionsPolicy?: { allowsFeature?: (name: string) => boolean }
    featurePolicy?: { allowsFeature?: (name: string) => boolean }
  }
  const policy =
    policyDocument.permissionsPolicy ?? policyDocument.featurePolicy
  if (typeof policy?.allowsFeature !== "function") return true
  try {
    return policy.allowsFeature(feature)
  } catch {
    return true
  }
}

export function serializeGetRequest(
  publicKey: PublicKeyCredentialRequestOptions,
): PasskeyGetRequest {
  return {
    rpId: publicKey.rpId || window.location.hostname,
    challenge: bufferToBase64Url(publicKey.challenge),
    allowCredentials: serializeDescriptors(publicKey.allowCredentials),
    userVerification: publicKey.userVerification,
    origin: window.location.origin,
    crossOrigin: isCrossOriginFrame(),
  }
}

export function serializeCreateRequest(
  publicKey: PublicKeyCredentialCreationOptions,
): PasskeyCreateRequest {
  return {
    rpId: publicKey.rp.id || window.location.hostname,
    rpName: publicKey.rp.name || publicKey.rp.id || window.location.hostname,
    challenge: bufferToBase64Url(publicKey.challenge),
    userId: bufferToBase64Url(publicKey.user.id),
    userName: publicKey.user.name,
    userDisplayName: publicKey.user.displayName || publicKey.user.name,
    pubKeyCredParams: publicKey.pubKeyCredParams
      .filter((param) => param.type === "public-key")
      .map((param) => param.alg),
    excludeCredentials: serializeDescriptors(publicKey.excludeCredentials),
    residentKey: publicKey.authenticatorSelection?.residentKey,
    userVerification: publicKey.authenticatorSelection?.userVerification,
    origin: window.location.origin,
    crossOrigin: isCrossOriginFrame(),
  }
}

function wrapPublicKeyCredential(
  metadata: {
    id: string
    rawId: string
    authenticatorAttachment: "platform"
  },
  response: object,
  responseJson: Record<string, unknown>,
): Credential {
  const credentialPrototype =
    typeof PublicKeyCredential !== "undefined"
      ? PublicKeyCredential.prototype
      : Object.prototype
  const credential = Object.create(credentialPrototype)
  Object.defineProperties(credential, {
    id: { value: metadata.id, enumerable: true },
    rawId: { value: base64UrlToBuffer(metadata.rawId), enumerable: true },
    type: { value: "public-key", enumerable: true },
    authenticatorAttachment: {
      value: metadata.authenticatorAttachment,
      enumerable: true,
    },
    response: { value: response, enumerable: true },
    getClientExtensionResults: { value: () => ({}) },
    toJSON: {
      value: () => ({
        id: metadata.id,
        rawId: metadata.rawId,
        type: "public-key",
        authenticatorAttachment: metadata.authenticatorAttachment,
        response: responseJson,
        clientExtensionResults: {},
      }),
    },
  })
  return credential as Credential
}

export function buildAssertionCredential(
  result: SerializedGetResult,
): Credential {
  const responsePrototype =
    typeof AuthenticatorAssertionResponse !== "undefined"
      ? AuthenticatorAssertionResponse.prototype
      : Object.prototype
  const response = Object.create(responsePrototype)
  Object.defineProperties(response, {
    clientDataJSON: {
      value: base64UrlToBuffer(result.response.clientDataJSON),
      enumerable: true,
    },
    authenticatorData: {
      value: base64UrlToBuffer(result.response.authenticatorData),
      enumerable: true,
    },
    signature: {
      value: base64UrlToBuffer(result.response.signature),
      enumerable: true,
    },
    userHandle: {
      value: result.response.userHandle
        ? base64UrlToBuffer(result.response.userHandle)
        : null,
      enumerable: true,
    },
  })
  return wrapPublicKeyCredential(result, response, {
    clientDataJSON: result.response.clientDataJSON,
    authenticatorData: result.response.authenticatorData,
    signature: result.response.signature,
    ...(result.response.userHandle
      ? { userHandle: result.response.userHandle }
      : {}),
  })
}

export function buildAttestationCredential(
  result: SerializedCreateResult,
): Credential {
  const authenticatorData = base64UrlToBuffer(result.response.authenticatorData)
  const publicKey = base64UrlToBuffer(result.response.publicKey)
  const transports = [...result.response.transports]
  const responsePrototype =
    typeof AuthenticatorAttestationResponse !== "undefined"
      ? AuthenticatorAttestationResponse.prototype
      : Object.prototype
  const response = Object.create(responsePrototype)
  Object.defineProperties(response, {
    clientDataJSON: {
      value: base64UrlToBuffer(result.response.clientDataJSON),
      enumerable: true,
    },
    attestationObject: {
      value: base64UrlToBuffer(result.response.attestationObject),
      enumerable: true,
    },
    getTransports: { value: () => [...transports] },
    getAuthenticatorData: { value: () => authenticatorData.slice(0) },
    getPublicKey: { value: () => publicKey.slice(0) },
    getPublicKeyAlgorithm: { value: () => result.response.publicKeyAlgorithm },
  })
  return wrapPublicKeyCredential(result, response, {
    clientDataJSON: result.response.clientDataJSON,
    attestationObject: result.response.attestationObject,
    authenticatorData: result.response.authenticatorData,
    publicKey: result.response.publicKey,
    publicKeyAlgorithm: result.response.publicKeyAlgorithm,
    transports,
  })
}

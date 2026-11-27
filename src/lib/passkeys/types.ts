import type { VaultInfo } from "@/lib/providers/types"

/**
 * A FIDO2 passkey stored inside a Bitwarden login cipher's `Login.Fido2Credentials` array.
 * Field names match Bitwarden's encrypted object properties (camelCased in TypeScript).
 */
export interface StoredPasskey {
  credentialId: string
  keyType: string
  keyAlgorithm: string
  keyCurve: string
  /** Base64url-encoded PKCS#8 ECDSA P-256 private key. */
  keyValue: string
  rpId: string
  rpName: string
  /** Base64url-encoded user handle bytes. */
  userHandle: string
  userName: string
  userDisplayName: string
  /** Decimal integer string ("0" for synced passkeys unless incremented). */
  counter: string
  discoverable: "true" | "false"
  /** ISO-8601 creation timestamp. */
  creationDate: string
}

/** Non-secret passkey metadata shown in Keyward's inline menu and passkey chooser popup. */
export interface PasskeyOption {
  vaultId: string
  vaultName: string
  loginId: string
  itemName: string
  credentialId: string
  rpId: string
  userName: string
  userDisplayName: string
  creationDate: string
}

export interface PasskeyDescriptor {
  type: "public-key"
  /** Base64url-encoded credential ID bytes. */
  id: string
  transports?: string[]
}

/** Serialized `PublicKeyCredentialCreationOptions` sent across the page <-> background bridge. */
export interface PasskeyCreateRequest {
  rpId: string
  rpName: string
  /** Base64url-encoded challenge. */
  challenge: string
  /** Base64url-encoded user.id. */
  userId: string
  userName: string
  userDisplayName: string
  /** COSE algorithm identifiers accepted by the RP (e.g. [-7, -257]). */
  pubKeyCredParams: number[]
  excludeCredentials: PasskeyDescriptor[]
  residentKey?: "discouraged" | "preferred" | "required"
  userVerification?: "required" | "preferred" | "discouraged"
  /** Page origin (`window.location.origin`). */
  origin: string
  /** Whether the requesting frame is cross-origin relative to the top-level document. */
  crossOrigin: boolean
}

/** Serialized `PublicKeyCredentialRequestOptions` sent across the page <-> background bridge. */
export interface PasskeyGetRequest {
  rpId: string
  /** Base64url-encoded challenge. */
  challenge: string
  allowCredentials: PasskeyDescriptor[]
  userVerification?: "required" | "preferred" | "discouraged"
  /** Page origin (`window.location.origin`). */
  origin: string
  /** Whether the requesting frame is cross-origin relative to the top-level document. */
  crossOrigin: boolean
}

/** Wire representation of a newly created `PublicKeyCredential` (attestation). */
export interface SerializedCreateResult {
  /** Base64url-encoded credential ID. */
  id: string
  /** Base64url-encoded rawId bytes (identical to `id`). */
  rawId: string
  authenticatorAttachment: "platform"
  response: {
    clientDataJSON: string
    attestationObject: string
    authenticatorData: string
    publicKey: string
    publicKeyAlgorithm: -7
    transports: string[]
  }
}

/** Wire representation of a signed `PublicKeyCredential` (assertion). */
export interface SerializedGetResult {
  /** Base64url-encoded credential ID. */
  id: string
  /** Base64url-encoded rawId bytes (identical to `id`). */
  rawId: string
  authenticatorAttachment: "platform"
  response: {
    clientDataJSON: string
    authenticatorData: string
    signature: string
    userHandle: string | null
  }
}

export type PasskeyBridgeOutcome =
  | { kind: "created"; credential: SerializedCreateResult }
  | { kind: "asserted"; credential: SerializedGetResult }
  | { kind: "fallback" }
  | { kind: "cancel" }
  | { kind: "error"; name: string; message: string }

/** State rendered by the popup's passkey chooser/save view. */
export interface PasskeyPromptView {
  kind: "get" | "create"
  rpId: string
  rpName: string
  origin: string
  /** For `get`: matching Bitwarden passkeys in unlocked vaults. */
  passkeys: PasskeyOption[]
  /** For `create`: user info from the RP. */
  userName?: string
  userDisplayName?: string
  /** For `create`: unlocked Bitwarden vaults & existing matching logins to optionally attach to. */
  saveTargets: {
    vault: VaultInfo
    existingLogins: { id: string; title: string; username: string }[]
  }[]
  /** Locked Bitwarden vaults the user can unlock right from the passkey view. */
  lockedVaults: VaultInfo[]
}

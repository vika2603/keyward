import { objectAt, valueAt } from "./api"
import type { VaultCrypto } from "./crypto"

/** The keys an account needs to read its items: its own key and the keys of its organizations. */
export class VaultKeys {
  private constructor(
    private readonly vaultCrypto: VaultCrypto,
    readonly userKey: Uint8Array,
    private readonly organizationKeys: Map<string, Uint8Array>,
  ) {}

  static fromProfile(
    vaultCrypto: VaultCrypto,
    userKey: Uint8Array,
    profile: unknown,
  ): VaultKeys {
    const organizationKeys = new Map<string, Uint8Array>()
    const organizations = valueAt(profile, "Organizations")
    const wrappedPrivateKey =
      valueAt(
        objectAt(
          objectAt(profile, "AccountKeys"),
          "PublicKeyEncryptionKeyPair",
        ),
        "WrappedPrivateKey",
      ) ?? valueAt(profile, "PrivateKey")
    if (
      typeof wrappedPrivateKey === "string" &&
      Array.isArray(organizations) &&
      organizations.length
    ) {
      const privateKey = vaultCrypto.unwrapPrivateKey(
        wrappedPrivateKey,
        userKey,
      )
      for (const organization of organizations) {
        const id = valueAt(organization, "Id")
        const key = valueAt(organization, "Key")
        if (typeof id !== "string" || typeof key !== "string") continue
        try {
          organizationKeys.set(id, vaultCrypto.decapsulateKey(key, privateKey))
        } catch {
          // An organization whose key cannot be read is skipped; its items stay hidden.
        }
      }
    }
    return new VaultKeys(vaultCrypto, userKey, organizationKeys)
  }

  /** The key of an organization whose key could be read. */
  forOrganization(organizationId: string): Uint8Array | undefined {
    return this.organizationKeys.get(organizationId)
  }

  /** The key of an item: its own key when it has one, else the key of its owner. */
  forCipher(cipher: unknown): Uint8Array {
    const organizationId = valueAt(cipher, "OrganizationId")
    const ownerKey =
      typeof organizationId === "string"
        ? this.organizationKeys.get(organizationId)
        : this.userKey
    if (!ownerKey) throw new Error("Missing organization key")
    const itemKey = valueAt(cipher, "Key")
    if (typeof itemKey !== "string" || !itemKey) return ownerKey
    return this.vaultCrypto.unwrapKey(itemKey, ownerKey)
  }

  decrypt(value: unknown, key: Uint8Array): string {
    return typeof value === "string" && value
      ? this.vaultCrypto.decryptString(value, key)
      : ""
  }

  encrypt(value: string, key: Uint8Array): string | null {
    return value ? this.vaultCrypto.encryptString(value, key) : null
  }
}

import { createRequire } from "node:module"
import type { PureCrypto } from "@bitwarden/sdk-internal"
import { describe, expect, it } from "vitest"
import {
  KdfType,
  masterKeySalt,
  pureCryptoAdapter,
  stretchMasterKey,
  WrongPasswordError,
} from "./crypto"
import {
  decryptLogin,
  decryptPassword,
  passwordUpdateRequest,
  VaultKeys,
} from "./vault"

// The SDK's Node build runs the same WebAssembly as the extension.
const sdk = createRequire(import.meta.url)(
  "@bitwarden/sdk-internal/node/bitwarden_wasm_internal.js",
).PureCrypto as typeof PureCrypto
const crypto = pureCryptoAdapter(sdk)

// The SDK refuses PBKDF2 below 5000 iterations; real accounts use more.
const kdf = { type: KdfType.Pbkdf2Sha256, iterations: 5000 }

describe("master password unlock", () => {
  const email = "Test.User@Example.com"
  const userKey = sdk.make_user_key_aes256_cbc_hmac()
  const wrapped = sdk.encrypt_user_key_with_master_password(
    userKey,
    "test master password",
    email,
    {
      pBKDF2: { iterations: kdf.iterations },
    },
  )

  const unwrap = async (password: string) => {
    const masterKey = crypto.deriveMasterKey(
      password,
      masterKeySalt(email, null),
      kdf,
    )
    return crypto.unwrapUserKey(wrapped, await stretchMasterKey(masterKey))
  }

  it("recovers the user key with the right password", async () => {
    expect(await unwrap("test master password")).toEqual(userKey)
  })

  it("reports a wrong password as such", async () => {
    await expect(unwrap("wrong password")).rejects.toBeInstanceOf(
      WrongPasswordError,
    )
  })
})

describe("organization items", () => {
  const userKey = sdk.make_user_key_aes256_cbc_hmac()
  const privateKey = sdk.rsa_generate_keypair()
  const orgKey = sdk.make_user_key_aes256_cbc_hmac()
  const itemKey = sdk.make_user_key_aes256_cbc_hmac()
  const profile = {
    PrivateKey: sdk.wrap_decapsulation_key(privateKey, userKey),
    Organizations: [
      {
        Id: "org-1",
        Key: sdk.encapsulate_key_unsigned(
          orgKey,
          sdk.rsa_extract_public_key(privateKey),
        ),
      },
    ],
  }
  const history = Array.from({ length: 5 }, (_, i) => ({
    Password: sdk.symmetric_encrypt_string(`old-${i}`, itemKey),
    LastUsedDate: "2026-01-01T00:00:00.000Z",
  }))
  const cipher = {
    Id: "item-1",
    Type: 1,
    OrganizationId: "org-1",
    Key: sdk.wrap_symmetric_key(itemKey, orgKey),
    Name: sdk.symmetric_encrypt_string("Example", itemKey),
    Login: {
      Username: sdk.symmetric_encrypt_string("someone", itemKey),
      Password: sdk.symmetric_encrypt_string("previous-password", itemKey),
      Uris: [
        {
          Uri: sdk.symmetric_encrypt_string("https://example.com", itemKey),
          Match: 1,
        },
      ],
    },
    PasswordHistory: history,
  }
  const keys = VaultKeys.fromProfile(crypto, userKey, profile)

  it("decrypts an item that has its own key through the organization key", () => {
    expect(decryptLogin(cipher, keys)).toEqual({
      id: "item-1",
      organizationId: "org-1",
      name: "Example",
      username: "someone",
      uris: [{ uri: "https://example.com", match: 1 }],
    })
    expect(decryptPassword(cipher, keys)).toBe("previous-password")
  })

  it("replaces the password, keeps the other fields and moves the old password to the history", () => {
    const request = passwordUpdateRequest(
      cipher,
      "next-password",
      keys,
      "user-1",
    )
    const login = request.login as Record<string, unknown>
    expect(sdk.symmetric_decrypt_string(String(login.password), itemKey)).toBe(
      "next-password",
    )
    expect(login.username).toBe(cipher.Login.Username)
    expect(request.name).toBe(cipher.Name)
    expect(request.key).toBe(cipher.Key)
    const passwords = (request.passwordHistory as { password: string }[]).map(
      (h) => sdk.symmetric_decrypt_string(h.password, itemKey),
    )
    expect(passwords).toEqual([
      "previous-password",
      "old-0",
      "old-1",
      "old-2",
      "old-3",
    ])
  })
})

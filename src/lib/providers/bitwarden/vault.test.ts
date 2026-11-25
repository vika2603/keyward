import { createHash } from "node:crypto"
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
  decryptDetails,
  decryptGroups,
  decryptLogin,
  decryptNote,
  decryptPassword,
  decryptPasswordHistory,
  decryptTotp,
  itemUpdateRequest,
  type LoginItem,
  loginCiphers,
  matchesQuery,
  newNoteRequest,
  noteCiphers,
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
      grouping: { organizationId: "org-1", folderId: null, collectionIds: [] },
      favorite: false,
      name: "Example",
      username: "someone",
      uris: [{ uri: "https://example.com", match: 1 }],
      hasTotp: false,
      reprompt: false,
    })
    expect(decryptPassword(cipher, keys)).toBe("previous-password")
  })

  it("names the organization, folders and collections, leaving out those it cannot read", () => {
    const sync = {
      Profile: {
        Organizations: [
          { Id: "org-1", Name: "Family" },
          { Id: "org-2", Name: "Without a key" },
        ],
      },
      Folders: [
        { Id: "folder-1", Name: sdk.symmetric_encrypt_string("Work", userKey) },
        { Id: "folder-2", Name: "not encrypted text" },
      ],
      Collections: [
        {
          Id: "collection-1",
          OrganizationId: "org-1",
          Name: sdk.symmetric_encrypt_string("Shared", orgKey),
        },
        {
          Id: "collection-2",
          OrganizationId: "org-2",
          Name: sdk.symmetric_encrypt_string("Hidden", orgKey),
        },
      ],
    }
    expect(decryptGroups(sync, keys)).toEqual({
      organizations: [{ id: "org-1", name: "Family" }],
      folders: [{ id: "folder-1", name: "Work" }],
      collections: [
        { id: "collection-1", organizationId: "org-1", name: "Shared" },
      ],
    })
  })

  it("tells where an item sits", () => {
    const placed = {
      ...cipher,
      FolderId: "folder-1",
      CollectionIds: ["collection-1", ""],
    }
    expect(decryptLogin(placed, keys).grouping).toEqual({
      organizationId: "org-1",
      folderId: "folder-1",
      collectionIds: ["collection-1"],
    })
  })

  it("replaces the password, keeps the other fields and moves the old password to the history", async () => {
    const request = await itemUpdateRequest(
      cipher,
      { password: "next-password" },
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

  it("sets an authenticator key and leaves the password and its history alone", async () => {
    const totp = "otpauth://totp/Example:someone?secret=TESTKEY"
    const request = await itemUpdateRequest(cipher, { totp }, keys, "user-1")
    const login = request.login as Record<string, unknown>
    expect(sdk.symmetric_decrypt_string(String(login.totp), itemKey)).toBe(totp)
    expect(login.password).toBe(cipher.Login.Password)
    expect(login.passwordRevisionDate).toBeNull()
    expect(request.passwordHistory).toEqual(
      history.map((h) => ({
        password: h.Password,
        lastUsedDate: h.LastUsedDate,
      })),
    )
  })

  it("keeps an address that stays and adds a new one with the checksum other apps check", async () => {
    const request = await itemUpdateRequest(
      cipher,
      {
        name: "Renamed",
        notes: "",
        uris: [
          { uri: "https://example.com", match: 2 },
          { uri: "https://login.example.com", match: null },
        ],
      },
      keys,
      "user-1",
    )
    const login = request.login as {
      uris: { uri: string; match: unknown; uriChecksum: string | null }[]
    }
    expect(sdk.symmetric_decrypt_string(String(request.name), itemKey)).toBe(
      "Renamed",
    )
    expect(request.notes).toBeNull()
    // A kept address keeps its encrypted text and takes the match chosen now.
    expect(login.uris[0]).toEqual({
      uri: cipher.Login.Uris[0]?.Uri,
      match: 2,
      uriChecksum: null,
    })
    const added = login.uris[1]
    expect(sdk.symmetric_decrypt_string(String(added?.uri), itemKey)).toBe(
      "https://login.example.com",
    )
    expect(added?.match).toBeNull()
    // The SHA-256 of the address in base64, as Bitwarden's clients compute it.
    expect(
      sdk.symmetric_decrypt_string(String(added?.uriChecksum), itemKey),
    ).toBe(
      createHash("sha256").update("https://login.example.com").digest("base64"),
    )
  })
})

describe("search", () => {
  const item: LoginItem = {
    id: "item-4",
    organizationId: null,
    grouping: { organizationId: null, folderId: null, collectionIds: [] },
    favorite: false,
    name: "Work Mail",
    username: "someone@example.com",
    uris: [{ uri: "https://mail.example.org/login", match: null }],
    hasTotp: false,
    reprompt: false,
  }

  it("finds an item by any word of its name, username or addresses, ignoring case", () => {
    expect(matchesQuery(item, "work")).toBe(true)
    expect(matchesQuery(item, "SOMEONE@")).toBe(true)
    expect(matchesQuery(item, "mail.example.org")).toBe(true)
  })

  it("needs every word of the query", () => {
    expect(matchesQuery(item, "mail someone")).toBe(true)
    expect(matchesQuery(item, "mail github")).toBe(false)
  })

  it("finds nothing for an empty query", () => {
    expect(matchesQuery(item, "   ")).toBe(false)
  })
})

describe("item details", () => {
  const userKey = sdk.make_user_key_aes256_cbc_hmac()
  const keys = VaultKeys.fromProfile(crypto, userKey, {})
  const totpKey = "otpauth://totp/Example:someone?secret=TESTKEY&issuer=Example"
  const cipher = {
    Id: "item-2",
    Type: 1,
    Reprompt: 1,
    Name: sdk.symmetric_encrypt_string("Example", userKey),
    Notes: sdk.symmetric_encrypt_string("first line\nsecond line", userKey),
    CreationDate: "2026-03-01T08:00:00.000Z",
    RevisionDate: "2026-04-02T09:30:00.000Z",
    Login: {
      Username: sdk.symmetric_encrypt_string("someone", userKey),
      Totp: sdk.symmetric_encrypt_string(totpKey, userKey),
      PasswordRevisionDate: "2026-04-01T12:00:00.000Z",
      Uris: [],
    },
  }

  it("tells that an item has an authenticator key and asks for re-prompt without decrypting the key", () => {
    expect(decryptLogin(cipher, keys)).toMatchObject({
      hasTotp: true,
      reprompt: true,
    })
  })

  it("decrypts the notes and reads the dates", () => {
    expect(decryptDetails(cipher, keys)).toEqual({
      notes: "first line\nsecond line",
      customFields: [],
      pastPasswordCount: 0,
      created: Date.parse("2026-03-01T08:00:00.000Z"),
      modified: Date.parse("2026-04-02T09:30:00.000Z"),
      passwordModified: Date.parse("2026-04-01T12:00:00.000Z"),
      hasPasskey: false,
    })
  })

  it("tells a login that keeps a passkey", () => {
    const withPasskey = {
      ...cipher,
      Login: { ...cipher.Login, Fido2Credentials: [{ CredentialId: "x" }] },
    }
    expect(decryptDetails(withPasskey, keys).hasPasskey).toBe(true)
  })

  it("decrypts the authenticator key", () => {
    expect(decryptTotp(cipher, keys)).toBe(totpKey)
  })

  it("decrypts custom fields of each type and skips a link to a field logins do not have", () => {
    const encrypt = (text: string) =>
      sdk.symmetric_encrypt_string(text, userKey)
    const withFields = {
      ...cipher,
      Fields: [
        { Type: 0, Name: encrypt("Account number"), Value: encrypt("12345") },
        { Type: 1, Name: encrypt("Recovery phrase"), Value: encrypt("a b c") },
        { Type: 2, Name: encrypt("Work account"), Value: encrypt("true") },
        { Type: 3, Name: encrypt("Login"), Value: null, LinkedId: 100 },
        { Type: 3, Name: encrypt("Card number"), Value: null, LinkedId: 304 },
      ],
    }
    expect(decryptDetails(withFields, keys).customFields).toEqual([
      { kind: "text", name: "Account number", value: "12345" },
      { kind: "hidden", name: "Recovery phrase", value: "a b c" },
      { kind: "checkbox", name: "Work account", checked: true },
      { kind: "linked", name: "Login", linkedTo: "username" },
    ])
  })

  it("saves edited custom fields and keeps a replaced hidden value in the history", async () => {
    const encrypt = (text: string) =>
      sdk.symmetric_encrypt_string(text, userKey)
    const withFields = {
      ...cipher,
      Reprompt: 0,
      Fields: [
        { Type: 1, Name: encrypt("PIN"), Value: encrypt("1111") },
        { Type: 1, Name: encrypt("Backup"), Value: encrypt("kept") },
        { Type: 9, Name: encrypt("Future type"), Value: encrypt("x") },
      ],
    }
    const request = await itemUpdateRequest(
      withFields,
      {
        customFields: [
          { kind: "hidden", name: "PIN", value: "2222" },
          { kind: "hidden", name: "Backup", value: "kept" },
          { kind: "linked", name: "user", linkedTo: "username" },
        ],
      },
      keys,
      "user-1",
    )
    const fields = request.fields as Record<string, unknown>[]
    const decrypt = (value: unknown) =>
      typeof value === "string"
        ? sdk.symmetric_decrypt_string(value, userKey)
        : value
    expect(
      fields.map((field) => [
        field.type,
        decrypt(field.name),
        decrypt(field.value),
        field.linkedId,
      ]),
    ).toEqual([
      [1, "PIN", "2222", null],
      [1, "Backup", "kept", null],
      [3, "user", null, 100],
      [9, "Future type", "x", null],
    ])
    const history = request.passwordHistory as { password: string }[]
    expect(history.map((entry) => decrypt(entry.password))).toEqual([
      "PIN: 1111",
    ])
  })

  it("leaves the fields and the history alone when the change does not touch the fields", async () => {
    const withFields = {
      ...cipher,
      Fields: [
        {
          Type: 0,
          Name: sdk.symmetric_encrypt_string("Account", userKey),
          Value: sdk.symmetric_encrypt_string("12345", userKey),
        },
      ],
    }
    const request = await itemUpdateRequest(
      withFields,
      { notes: "changed" },
      keys,
      "user-1",
    )
    expect(request.fields).toEqual([
      {
        type: 0,
        name: withFields.Fields[0]?.Name,
        value: withFields.Fields[0]?.Value,
        linkedId: null,
      },
    ])
    expect(request.passwordHistory).toBeNull()
  })

  it("counts earlier passwords and decrypts them newest first", () => {
    const withHistory = {
      ...cipher,
      PasswordHistory: [
        {
          Password: sdk.symmetric_encrypt_string("older", userKey),
          LastUsedDate: "2026-02-01T00:00:00.000Z",
        },
        {
          Password: sdk.symmetric_encrypt_string("newer", userKey),
          LastUsedDate: "2026-03-01T00:00:00.000Z",
        },
      ],
    }
    expect(decryptDetails(withHistory, keys).pastPasswordCount).toBe(2)
    expect(decryptPasswordHistory(withHistory, keys)).toEqual([
      { password: "newer", replaced: Date.parse("2026-03-01T00:00:00.000Z") },
      { password: "older", replaced: Date.parse("2026-02-01T00:00:00.000Z") },
    ])
  })

  it("reports no key and no dates for an item without them", () => {
    const bare = { Id: "item-3", Type: 1, Login: {} }
    expect(decryptLogin(bare, keys).hasTotp).toBe(false)
    expect(decryptTotp(bare, keys)).toBe("")
    expect(decryptDetails(bare, keys)).toEqual({
      notes: "",
      customFields: [],
      pastPasswordCount: 0,
      created: undefined,
      modified: undefined,
      passwordModified: undefined,
      hasPasskey: false,
    })
  })
})

describe("secure notes", () => {
  const userKey = sdk.make_user_key_aes256_cbc_hmac()
  const keys = VaultKeys.fromProfile(crypto, userKey, {})
  const encrypt = (text: string) => sdk.symmetric_encrypt_string(text, userKey)
  const decrypt = (value: unknown) =>
    typeof value === "string"
      ? sdk.symmetric_decrypt_string(value, userKey)
      : value
  const note = {
    Id: "note-1",
    Type: 2,
    Name: encrypt("Wi-Fi"),
    Notes: encrypt("first line\nsecond line"),
    SecureNote: { Type: 0 },
    RevisionDate: "2026-04-02T09:30:00.000Z",
  }

  it("lists notes apart from logins and leaves out deleted and archived ones", () => {
    const sync = {
      Ciphers: [
        note,
        { ...note, Id: "note-2", DeletedDate: "2026-05-01T00:00:00.000Z" },
        { ...note, Id: "note-3", ArchivedDate: "2026-05-01T00:00:00.000Z" },
        { Id: "login-1", Type: 1, Login: {} },
        {
          Id: "login-2",
          Type: 1,
          Login: {},
          ArchivedDate: "2026-05-01T00:00:00.000Z",
        },
      ],
    }
    expect(noteCiphers(sync).map((cipher) => cipher.Id)).toEqual(["note-1"])
    expect(loginCiphers(sync).map((cipher) => cipher.Id)).toEqual(["login-1"])
    expect(decryptNote(note, keys)).toEqual({
      id: "note-1",
      name: "Wi-Fi",
      reprompt: false,
      grouping: { organizationId: null, folderId: null, collectionIds: [] },
      favorite: false,
    })
  })

  it("encrypts a new note with its custom fields", () => {
    const request = newNoteRequest(
      {
        name: "Wi-Fi",
        text: "network details",
        customFields: [{ kind: "hidden", name: "Key", value: "fake" }],
      },
      keys,
      "user-1",
    )
    expect(request.type).toBe(2)
    expect(request.secureNote).toEqual({ type: 0 })
    expect(decrypt(request.name)).toBe("Wi-Fi")
    expect(decrypt(request.notes)).toBe("network details")
    const [field] = request.fields as Record<string, unknown>[]
    expect([field?.type, decrypt(field?.name), decrypt(field?.value)]).toEqual([
      1,
      "Key",
      "fake",
    ])
  })

  it("updates a note as a note, without a login part", async () => {
    const request = await itemUpdateRequest(
      note,
      { notes: "changed" },
      keys,
      "user-1",
    )
    expect(request.type).toBe(2)
    expect(request.secureNote).toEqual({ type: 0 })
    expect(request.login).toBeUndefined()
    expect(request.name).toBe(note.Name)
    expect(decrypt(request.notes)).toBe("changed")
  })
})

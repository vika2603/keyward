import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import {
  accountIdOf,
  loadSync,
  saveAccount,
  saveSession,
  saveSync,
} from "./account-store"
import { BitwardenProvider } from "./bitwarden-provider"
import { KdfType, stretchMasterKey } from "./crypto"
import { decryptEquivalentDomains, textMatchesQuery } from "./decrypt"
import { sdk, testVaultCrypto } from "./test-sdk"
import { vaultIdOf } from "./vault-id"

const SERVER = "https://vault.example.test"
const ACCOUNT_ID = accountIdOf(SERVER, "user-p3")
const VAULT = vaultIdOf(ACCOUNT_ID)
const MASTER_PASSWORD = "offline-master-password"
const EMAIL = "phase3@example.test"

const kdf = { type: KdfType.Pbkdf2Sha256, iterations: 5000 }
const masterKey = testVaultCrypto.deriveMasterKey(MASTER_PASSWORD, EMAIL, kdf)
const userKey = sdk.make_user_key_aes256_cbc_hmac()
const enc = (text: string) => sdk.symmetric_encrypt_string(text, userKey)

async function seedAccount() {
  const stretched = await stretchMasterKey(masterKey)
  const wrappedUserKey = sdk.symmetric_encrypt_bytes(userKey, stretched)
  await saveAccount({
    id: ACCOUNT_ID,
    userId: "user-p3",
    email: EMAIL,
    server: SERVER,
    kdf,
    salt: EMAIL,
    wrappedUserKey,
    encryptedRefreshToken: enc("refresh-token"),
  })
  await saveSession(ACCOUNT_ID, {
    userKey: userKey.toBase64(),
    accessToken: "access-token",
    accessTokenExpiresAt: Date.now() + 60 * 60_000,
    refreshToken: "refresh-token",
  })
}

const syncData = {
  Profile: { Organizations: [] },
  Folders: [{ Id: "folder-travel", Name: enc("Voyagé & Flights") }],
  Collections: [],
  Domains: {
    EquivalentDomains: [["corp.example", "corp-sso.example"]],
    GlobalEquivalentDomains: [
      { Type: 1, Domains: ["apple.com", "icloud.com"], Excluded: false },
      {
        Type: 2,
        Domains: ["excluded-a.test", "excluded-b.test"],
        Excluded: true,
      },
    ],
  },
  Ciphers: [
    {
      Id: "login-cafe",
      Type: 1,
      Edit: true,
      Reprompt: 0,
      FolderId: "folder-travel",
      Name: enc("Café Portal"),
      Notes: enc("Loyalty membership #8842"),
      Fields: [
        { Type: 0, Name: enc("Company Code"), Value: enc("Zürich-HQ") },
        { Type: 1, Name: enc("Secret PIN"), Value: enc("999111") },
      ],
      Login: {
        Username: enc("traveller"),
        Password: enc("pw-1"),
        Uris: [{ Uri: enc("https://corp.example/login"), Match: null }],
      },
    },
    {
      Id: "login-apple",
      Type: 1,
      Edit: true,
      Reprompt: 0,
      Name: enc("Apple ID"),
      Login: {
        Username: enc("me@icloud.com"),
        Password: enc("pw-2"),
        Uris: [{ Uri: enc("https://apple.com"), Match: null }],
      },
    },
    {
      Id: "login-reprompt",
      Type: 1,
      Edit: true,
      Reprompt: 1,
      Name: enc("Bank"),
      Notes: enc("sensitive-reprompt-note"),
      Login: {
        Username: enc("banker"),
        Password: enc("pw-3"),
        Uris: [{ Uri: enc("https://bank.example"), Match: null }],
      },
    },
    {
      Id: "note-1",
      Type: 2,
      Edit: true,
      Reprompt: 0,
      FolderId: "folder-travel",
      Name: enc("Passport Info"),
      Notes: enc("Issued in Montréal, expires 2032"),
      Fields: [{ Type: 0, Name: enc("Country"), Value: enc("Canada") }],
    },
  ],
}

beforeEach(() => {
  fakeBrowser.reset()
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("Phase 3: search, equivalent domains, revision-date sync, and offline storage", () => {
  it("folds diacritics with NFD normalization in textMatchesQuery", () => {
    expect(textMatchesQuery("Café Résumé Über", "cafe resume uber")).toBe(true)
    expect(textMatchesQuery("Montréal", "montreal")).toBe(true)
    expect(textMatchesQuery("Plain text", "missing")).toBe(false)
  })

  it("extracts server custom and non-excluded global equivalent domains", () => {
    expect(decryptEquivalentDomains(syncData)).toEqual([
      ["corp.example", "corp-sso.example"],
      ["apple.com", "icloud.com"],
    ])
  })

  it("matches server equivalent domains during login lookup", async () => {
    await seedAccount()
    await saveSync(ACCOUNT_ID, { syncedAt: Date.now(), data: syncData })
    const provider = new BitwardenProvider(async () => testVaultCrypto)

    const corpMatches = await provider.logins(
      VAULT,
      new URL("https://corp-sso.example/signin"),
    )
    expect(corpMatches.map((item) => item.id)).toEqual(["login-cafe"])

    const icloudMatches = await provider.logins(
      VAULT,
      new URL("https://www.icloud.com/"),
    )
    expect(icloudMatches.map((item) => item.id)).toEqual(["login-apple"])

    // Excluded global equivalent domains are ignored.
    const excluded = await provider.logins(
      VAULT,
      new URL("https://excluded-b.test/"),
    )
    expect(excluded).toEqual([])
  })

  it("searches login notes, text custom fields, folder names, and note bodies without leaking hidden or reprompt secrets", async () => {
    await seedAccount()
    await saveSync(ACCOUNT_ID, { syncedAt: Date.now(), data: syncData })
    const provider = new BitwardenProvider(async () => testVaultCrypto)

    // Accent-insensitive title match
    expect((await provider.search(VAULT, "cafe")).map((i) => i.id)).toEqual([
      "login-cafe",
    ])
    // Login notes match
    expect((await provider.search(VAULT, "8842")).map((i) => i.id)).toEqual([
      "login-cafe",
    ])
    // Text custom field value match with diacritic folding
    expect((await provider.search(VAULT, "zurich")).map((i) => i.id)).toEqual([
      "login-cafe",
    ])
    // Folder name match with diacritic folding
    expect((await provider.search(VAULT, "voyage")).map((i) => i.id)).toEqual([
      "login-cafe",
    ])
    // Hidden custom field value must NOT match search
    expect(await provider.search(VAULT, "999111")).toEqual([])
    // Reprompt item notes must NOT match search
    expect(await provider.search(VAULT, "sensitive-reprompt-note")).toEqual([])

    // Note body and folder search with diacritic folding
    expect(
      (await provider.searchNotes(VAULT, "montreal")).map((n) => n.id),
    ).toEqual(["note-1"])
    expect(
      (await provider.searchNotes(VAULT, "voyage canada")).map((n) => n.id),
    ).toEqual(["note-1"])
  })

  it("keeps encrypted sync data in storage.local across lock for offline unlock and wipes it on sign-out", async () => {
    await seedAccount()
    await saveSync(ACCOUNT_ID, { syncedAt: Date.now(), data: syncData })
    const provider = new BitwardenProvider(async () => testVaultCrypto)

    // Lock clears session key but retains encrypted sync in storage.local.
    await provider.lock(VAULT)
    expect(await loadSync(ACCOUNT_ID)).not.toBeNull()

    // Simulate completely offline network: unlock + read works from storage.local!
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    )
    await provider.unlock(ACCOUNT_ID, MASTER_PASSWORD)
    const offlineLogins = await provider.logins(
      VAULT,
      new URL("https://corp.example/"),
    )
    expect(offlineLogins.map((item) => item.id)).toEqual(["login-cafe"])

    // Sign out wipes the encrypted sync from storage.local.
    await provider.signOut(ACCOUNT_ID)
    expect(await loadSync(ACCOUNT_ID)).toBeNull()
  })

  it("skips full /sync when /accounts/revision-date matches stored revision", async () => {
    await seedAccount()
    const oldSyncedAt = Date.now() - 10 * 60_000
    await saveSync(ACCOUNT_ID, {
      syncedAt: oldSyncedAt,
      revisionDate: 1730000000000,
      data: syncData,
    })

    const fetchMock = vi.fn(async (url: string | URL) => {
      const target = String(url)
      if (target.endsWith("/accounts/revision-date")) {
        return new Response("1730000000000", { status: 200 })
      }
      return new Response(JSON.stringify(syncData), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    })
    vi.stubGlobal("fetch", fetchMock)

    const provider = new BitwardenProvider(async () => testVaultCrypto)
    // Reading an older-than-5m vault triggers background refreshIfChanged.
    await provider.logins(VAULT, new URL("https://corp.example/"))
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/accounts/revision-date"),
        expect.anything(),
      )
    })
    // Full /sync was NOT fetched because revision-date matched.
    expect(
      fetchMock.mock.calls.some(([u]) => String(u).includes("/sync")),
    ).toBe(false)

    // Manual syncAll forces a full /sync without excludeDomains=true.
    await provider.syncAll()
    expect(
      fetchMock.mock.calls.some(
        ([u]) =>
          String(u).endsWith("/sync") && !String(u).includes("excludeDomains"),
      ),
    ).toBe(true)
  })
})

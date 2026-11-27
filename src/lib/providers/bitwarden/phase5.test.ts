import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { BitwardenProvider } from "./bitwarden-provider"
import { sdk, seedUnlockedAccount, testVaultCrypto } from "./test-sdk"

const SERVER = "https://vault.example.test"

const userKey = sdk.make_user_key_aes256_cbc_hmac()
const encUser = (text: string) => sdk.symmetric_encrypt_string(text, userKey)

const syncData = {
  Profile: { Organizations: [] },
  Folders: [],
  Collections: [],
  Ciphers: [
    {
      Id: "weak-http",
      Type: 1,
      Edit: true,
      Reprompt: 0,
      Name: encUser("Legacy Admin"),
      Login: {
        Username: encUser("admin"),
        Password: encUser("password123"),
        Uris: [{ Uri: encUser("http://legacy.example.com/login") }],
      },
    },
    {
      Id: "reused-1",
      Type: 1,
      Edit: true,
      Reprompt: 0,
      Name: encUser("App One"),
      Login: {
        Username: encUser("alice"),
        Password: encUser("k9#Tv!82qM$pL4@wX7zN"),
        Uris: [{ Uri: encUser("https://one.example.com") }],
      },
    },
    {
      Id: "reused-2",
      Type: 1,
      Edit: true,
      Reprompt: 0,
      Name: encUser("App Two"),
      Login: {
        Username: encUser("alice"),
        Password: encUser("k9#Tv!82qM$pL4@wX7zN"),
        Uris: [{ Uri: encUser("https://two.example.com") }],
      },
    },
    {
      Id: "strong-unique",
      Type: 1,
      Edit: true,
      Reprompt: 0,
      Name: encUser("Bank"),
      Login: {
        Username: encUser("alice"),
        Password: encUser("9rF&5yH*1uJ^6iK(0oP)8aS!"),
        Uris: [{ Uri: encUser("https://bank.example.com") }],
      },
    },
    {
      Id: "reprompt-weak",
      Type: 1,
      Edit: true,
      Reprompt: 1,
      Name: encUser("Protected"),
      Login: {
        Username: encUser("root"),
        Password: encUser("123456"),
        Uris: [{ Uri: encUser("http://protected.example.com") }],
      },
    },
    {
      Id: "trashed-weak",
      Type: 1,
      Edit: true,
      Reprompt: 0,
      DeletedDate: "2025-05-01T00:00:00Z",
      Name: encUser("Trashed"),
      Login: {
        Username: encUser("old"),
        Password: encUser("123456"),
        Uris: [{ Uri: encUser("http://old.example.com") }],
      },
    },
  ],
}

let provider: BitwardenProvider

beforeEach(async () => {
  fakeBrowser.reset()
  await seedUnlockedAccount({
    server: SERVER,
    userId: "user-p5",
    email: "alice@example.test",
    name: "Alice",
    userKey,
    syncData,
  })
  provider = new BitwardenProvider(async () => testVaultCrypto)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("Phase 5: BitwardenProvider local securityAudit", () => {
  it("flags weak, reused, and HTTP items locally without making any network requests", async () => {
    const fetchMock = vi.fn(() => {
      throw new Error("securityAudit must stay 100% local")
    })
    vi.stubGlobal("fetch", fetchMock)

    const report = await provider.securityAudit()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(report.totalChecked).toBe(4)
    expect(report.weak.map((f) => f.login.id)).toEqual(["weak-http"])
    expect(report.weak[0]?.changePasswordUrl).toBe(
      "https://legacy.example.com/.well-known/change-password",
    )
    expect(report.reused.map((f) => f.login.id).sort()).toEqual([
      "reused-1",
      "reused-2",
    ])
    expect(report.reused[0]?.reuseCount).toBe(2)
    expect(report.insecureHttp.map((f) => f.login.id)).toEqual(["weak-http"])
  })
})

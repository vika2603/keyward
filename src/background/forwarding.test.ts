import { beforeEach, describe, expect, it } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { clearSession } from "@/lib/providers/bitwarden/account-store"
import { BitwardenProvider } from "@/lib/providers/bitwarden/bitwarden-provider"
import {
  sdk,
  seedUnlockedAccount,
  testVaultCrypto,
} from "@/lib/providers/bitwarden/test-sdk"
import { ForwardingStore } from "./forwarding"

const API_KEY = "sl-api-key-for-tests"
const settings = { apiKey: API_KEY, domain: "", baseUrl: "" }

function setUp() {
  const bitwarden = new BitwardenProvider(async () => testVaultCrypto)
  return { bitwarden, store: new ForwardingStore(bitwarden) }
}

async function storedText(area: "local" | "session"): Promise<string> {
  return JSON.stringify(await fakeBrowser.storage[area].get(null))
}

beforeEach(() => {
  fakeBrowser.reset()
})

describe("email forwarding settings with a Bitwarden account", () => {
  it("keeps the API key encrypted with the account's key", async () => {
    const { store } = setUp()
    await seedUnlockedAccount({
      userId: "user-1",
      userKey: sdk.make_user_key_aes256_cbc_hmac(),
    })
    await store.save("simplelogin", settings)
    expect(await storedText("local")).not.toContain(API_KEY)
    expect(await storedText("session")).not.toContain(API_KEY)
    expect((await store.settings("simplelogin")).apiKey).toBe(API_KEY)
  })

  it("gives each service only its own key", async () => {
    const { store } = setUp()
    await seedUnlockedAccount({
      userId: "user-1",
      userKey: sdk.make_user_key_aes256_cbc_hmac(),
    })
    await store.save("simplelogin", settings)
    expect((await store.settings("addyio")).apiKey).toBe("")
  })

  it("reads and saves nothing while the account is locked", async () => {
    const { store } = setUp()
    const { accountId } = await seedUnlockedAccount({
      userId: "user-1",
      userKey: sdk.make_user_key_aes256_cbc_hmac(),
    })
    await store.save("simplelogin", settings)
    await clearSession(accountId)
    const view = await store.view()
    expect(view.keeper).toBe("bitwarden")
    expect(view.saved).toBeNull()
    await expect(store.settings("simplelogin")).rejects.toMatchObject({
      code: "locked",
    })
    await expect(store.save("simplelogin", settings)).rejects.toMatchObject({
      code: "locked",
    })
  })

  it("removes the encrypted settings when the account signs out", async () => {
    const { bitwarden, store } = setUp()
    const { accountId } = await seedUnlockedAccount({
      userId: "user-1",
      userKey: sdk.make_user_key_aes256_cbc_hmac(),
    })
    await store.save("simplelogin", settings)
    const before = await storedText("local")
    await bitwarden.signOut(accountId)
    expect(before).toContain("bitwarden.secrets.")
    expect(await storedText("local")).not.toContain("bitwarden.secrets.")
  })

  it("keeps the settings of each account apart", async () => {
    const { store } = setUp()
    await seedUnlockedAccount({
      userId: "user-1",
      userKey: sdk.make_user_key_aes256_cbc_hmac(),
    })
    const { accountId: second } = await seedUnlockedAccount({
      userId: "user-2",
      userKey: sdk.make_user_key_aes256_cbc_hmac(),
    })
    await store.save("simplelogin", settings, second)
    expect((await store.settings("simplelogin", second)).apiKey).toBe(API_KEY)
    expect((await store.settings("simplelogin")).apiKey).toBe("")
  })
})

describe("email forwarding settings without a Bitwarden account", () => {
  it("keeps them for the browser session only", async () => {
    const { store } = setUp()
    await store.save("simplelogin", settings)
    expect(await storedText("local")).not.toContain(API_KEY)
    expect((await store.view()).keeper).toBe("session")
    expect((await store.settings("simplelogin")).apiKey).toBe(API_KEY)
  })
})

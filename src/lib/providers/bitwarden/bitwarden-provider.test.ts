import { createRequire } from "node:module"
import type { PureCrypto } from "@bitwarden/sdk-internal"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import {
  accountIdOf,
  saveAccount,
  saveSession,
  saveSync,
} from "./account-store"
import { BitwardenProvider } from "./bitwarden-provider"
import { KdfType, pureCryptoAdapter } from "./crypto"
import { vaultIdOf } from "./vault-id"

// The SDK's Node build runs the same WebAssembly as the extension.
const sdk = createRequire(import.meta.url)(
  "@bitwarden/sdk-internal/node/bitwarden_wasm_internal.js",
).PureCrypto as typeof PureCrypto
const crypto = pureCryptoAdapter(sdk)

const SERVER = "https://vault.example.test"
const ACCOUNT_ID = accountIdOf(SERVER, "user-1")
const VAULT = vaultIdOf(ACCOUNT_ID)
const ACCESS_TOKEN = "test-access-token"

const userKey = sdk.make_user_key_aes256_cbc_hmac()
const enc = (text: string) => sdk.symmetric_encrypt_string(text, userKey)
const dec = (value: unknown) =>
  sdk.symmetric_decrypt_string(String(value), userKey)

function cipher(
  id: string,
  fields: { name: string; username: string; password: string; uri: string },
  extra: Record<string, unknown> = {},
) {
  return {
    Id: id,
    Type: 1,
    Edit: true,
    Reprompt: 0,
    Name: enc(fields.name),
    Notes: enc("first note"),
    RevisionDate: "2026-04-02T09:30:00.000Z",
    Login: {
      Username: enc(fields.username),
      Password: enc(fields.password),
      Uris: [{ Uri: enc(fields.uri), Match: null }],
    },
    ...extra,
  }
}

const ciphers = [
  cipher("item-1", {
    name: "Example Mail",
    username: "someone@example.com",
    password: "first-test-value",
    uri: "https://example.com",
  }),
  cipher("item-2", {
    name: "Other Site",
    username: "another",
    password: "second-test-value",
    uri: "https://other.test",
  }),
  cipher(
    "item-3",
    {
      name: "Shared Read Only",
      username: "reader",
      password: "third-test-value",
      uri: "https://example.com",
    },
    { Edit: false, FolderId: "folder-1" },
  ),
]

/** Requests the provider sent, with JSON bodies parsed. */
const requests: {
  method: string
  url: string
  body: unknown
  auth: string | null
}[] = []

beforeEach(async () => {
  fakeBrowser.reset()
  requests.length = 0
  const data = { Profile: {}, Ciphers: ciphers }
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const body = typeof init.body === "string" ? JSON.parse(init.body) : null
      requests.push({
        method: init.method ?? "GET",
        url,
        body,
        auth: new Headers(init.headers).get("Authorization"),
      })
      if (url.endsWith("/delete")) return new Response(null, { status: 200 })
      return Response.json(url.includes("/sync") ? data : {})
    }),
  )
  await saveAccount({
    id: ACCOUNT_ID,
    userId: "user-1",
    email: "someone@example.com",
    server: SERVER,
    kdf: { type: KdfType.Pbkdf2Sha256, iterations: 5000 },
    salt: "",
    wrappedUserKey: "unused",
    encryptedRefreshToken: "unused",
  })
  await saveSession(ACCOUNT_ID, {
    userKey: userKey.toBase64(),
    accessToken: ACCESS_TOKEN,
    accessTokenExpiresAt: Date.now() + 3_600_000,
    refreshToken: "unused",
  })
  await saveSync(ACCOUNT_ID, { syncedAt: Date.now(), data })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const provider = () => new BitwardenProvider(async () => crypto)
const writes = () => requests.filter((r) => r.method !== "GET")

describe("search", () => {
  it("finds logins of the whole vault by name, username or address, whatever the page", async () => {
    const ids = async (query: string) =>
      (await provider().search(VAULT, query)).map((l) => l.id)
    expect(await ids("other")).toEqual(["item-2"])
    expect(await ids("someone@")).toEqual(["item-1"])
    expect(await ids("example.com")).toEqual(["item-1", "item-3"])
    expect(await ids("nothing-like-this")).toEqual([])
  })
})

describe("reads from Keyward's own views", () => {
  it("reads any login without a page, and only the page's logins with one", async () => {
    const bw = provider()
    const tab = { tabId: 1, frameId: 0 }
    expect((await bw.credential(VAULT, "item-2", null, tab)).password).toBe(
      "second-test-value",
    )
    expect((await bw.details(VAULT, "item-2", null)).editable).toBe(true)
    await expect(
      bw.credential(VAULT, "item-2", new URL("https://example.com/"), tab),
    ).rejects.toMatchObject({ code: "notFound" })
  })
})

describe("edit", () => {
  it("sends only what changed and leaves the password and its history alone", async () => {
    await provider().edit(VAULT, "item-1", {
      name: "Example Mail",
      username: "someone@example.com",
      password: "first-test-value",
      uris: [
        { uri: "https://example.com", match: null },
        { uri: " https://login.example.com ", match: 3 },
      ],
      notes: "second note",
      totp: "",
    })
    const [update] = writes()
    expect(update?.method).toBe("PUT")
    expect(update?.url).toBe(`${SERVER}/api/ciphers/item-1`)
    expect(update?.auth).toBe(`Bearer ${ACCESS_TOKEN}`)
    const body = update?.body as Record<string, unknown> & {
      login: Record<string, unknown> & { uris: { uri: string }[] }
    }
    const saved = ciphers[0] as ReturnType<typeof cipher>
    expect(body.name).toBe(saved.Name)
    expect(body.login.password).toBe(saved.Login.Password)
    expect(body.login.passwordRevisionDate).toBeNull()
    expect(body.passwordHistory).toBeNull()
    expect(body.login.totp).toBeNull()
    expect(dec(body.notes)).toBe("second note")
    expect(body.login.uris.map((u) => dec(u.uri))).toEqual([
      "https://example.com",
      "https://login.example.com",
    ])
    expect(body.login.uris[0]?.uri).toBe(saved.Login.Uris[0]?.Uri)
    expect(
      body.login.uris.map((u) => (u as { match?: unknown }).match),
    ).toEqual([null, 3])
  })

  it("sends nothing when nothing changed", async () => {
    const bw = provider()
    await bw.edit(VAULT, "item-1", await bw.editable(VAULT, "item-1"))
    expect(writes()).toEqual([])
  })

  it("refuses an authenticator key that gives no codes", async () => {
    await expect(
      provider().edit(VAULT, "item-1", { totp: "not-a-key!" }),
    ).rejects.toMatchObject({ code: "invalidCodeKey" })
    expect(writes()).toEqual([])
  })
})

describe("setFavorite", () => {
  it("stars a read-only item of an organization and keeps its folder", async () => {
    const bw = provider()
    expect((await bw.details(VAULT, "item-3", null)).favorite).toBe(false)
    await bw.setFavorite(VAULT, "item-3", true)
    expect(writes()).toEqual([
      {
        method: "PUT",
        url: `${SERVER}/api/ciphers/item-3/partial`,
        body: { folderId: "folder-1", favorite: true },
        auth: `Bearer ${ACCESS_TOKEN}`,
      },
    ])
  })

  it("sends no folder for an item outside every folder", async () => {
    await provider().setFavorite(VAULT, "item-1", false)
    expect(writes()[0]?.body).toEqual({ folderId: null, favorite: false })
  })
})

describe("remove", () => {
  it("moves the login to the trash", async () => {
    await provider().remove(VAULT, "item-2")
    expect(writes()).toEqual([
      {
        method: "PUT",
        url: `${SERVER}/api/ciphers/item-2/delete`,
        body: null,
        auth: `Bearer ${ACCESS_TOKEN}`,
      },
    ])
  })

  it("leaves a read-only login of an organization alone", async () => {
    const bw = provider()
    expect((await bw.details(VAULT, "item-3", null)).editable).toBe(false)
    await expect(bw.remove(VAULT, "item-3")).rejects.toMatchObject({
      code: "notEditable",
    })
    await expect(
      bw.edit(VAULT, "item-3", { notes: "x" }),
    ).rejects.toMatchObject({ code: "notEditable" })
    expect(writes()).toEqual([])
  })
})

describe("account labels", () => {
  it("tells accounts with the same email apart by server, and shows a given name instead", async () => {
    const official = accountIdOf("", "user-2")
    await saveAccount({
      id: official,
      userId: "user-2",
      email: "Someone@example.com",
      server: "",
      kdf: { type: KdfType.Pbkdf2Sha256, iterations: 5000 },
      salt: "",
      wrappedUserKey: "unused",
      encryptedRefreshToken: "unused",
    })
    const bitwarden = provider()
    const labels = async () =>
      Object.fromEntries(
        (await bitwarden.accounts()).map((account) => [
          account.id,
          account.label,
        ]),
      )
    expect(await labels()).toEqual({
      [ACCOUNT_ID]: "someone@example.com · vault.example.test",
      [official]: "Someone@example.com · bitwarden.com",
    })
    await bitwarden.renameAccount(ACCOUNT_ID, "  Home server  ")
    expect(await labels()).toEqual({
      [ACCOUNT_ID]: "Home server",
      [official]: "Someone@example.com · bitwarden.com",
    })
    expect(
      (await bitwarden.vaults()).find((vault) => vault.id === VAULT)?.label,
    ).toBe("Home server")
    await bitwarden.renameAccount(ACCOUNT_ID, "")
    expect((await labels())[ACCOUNT_ID]).toBe(
      "someone@example.com · vault.example.test",
    )
  })
})

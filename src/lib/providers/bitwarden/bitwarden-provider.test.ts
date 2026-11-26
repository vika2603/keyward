import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import {
  accountIdOf,
  loadAccounts,
  loadSync,
  saveAccount,
  saveSession,
  saveSync,
} from "./account-store"
import { BitwardenProvider } from "./bitwarden-provider"
import { KdfType } from "./crypto"
import { sdk, testVaultCrypto } from "./test-sdk"
import { vaultIdOf } from "./vault-id"

// The SDK's Node build runs the same WebAssembly as the extension.

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
  cipher(
    "item-6",
    {
      name: "Guarded",
      username: "careful",
      password: "{{SECRET_7pyhp5ym}}",
      uri: "https://guarded.test",
    },
    { Reprompt: 1 },
  ),
  cipher(
    "item-4",
    {
      name: "Thrown Away",
      username: "former",
      password: "not-a-real-password",
      uri: "https://old.example.com",
    },
    { DeletedDate: "2026-11-01T08:00:00.000Z" },
  ),
  cipher(
    "item-5",
    {
      name: "Shared Thrown Away",
      username: "reader",
      password: "not-a-real-password",
      uri: "https://old.example.com",
    },
    { DeletedDate: "2026-11-01T08:00:00.000Z", Edit: false },
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

const provider = () => new BitwardenProvider(async () => testVaultCrypto)
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
    expect((await bw.credential(VAULT, "item-2", null)).password).toBe(
      "second-test-value",
    )
    expect((await bw.details(VAULT, "item-2", null)).editable).toBe(true)
    await expect(
      bw.credential(VAULT, "item-2", new URL("https://example.com/")),
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

describe("save", () => {
  const login = {
    url: new URL("https://new.example.com/signup"),
    username: "newcomer",
    password: "{{SECRET_5dcfwpk5}}",
  }

  it("names a login after its site when nothing else is given", async () => {
    await provider().save(VAULT, login)
    const body = writes()[0]?.body as Record<string, unknown> & {
      login: Record<string, unknown>
    }
    expect(dec(body.name)).toBe("new.example.com")
    expect(body.notes).toBeNull()
    expect(body.login.totp).toBeNull()
    expect(body.folderId).toBeNull()
  })

  it("keeps the name, notes, authenticator key, fields and folder given", async () => {
    await provider().save(VAULT, {
      ...login,
      details: {
        name: "New Example",
        notes: "made for a test",
        totp: "JBSWY3DPEHPK3PXP",
        customFields: [{ kind: "text", name: "Member", value: "42" }],
        folderId: null,
      },
    })
    const body = writes()[0]?.body as Record<string, unknown> & {
      login: Record<string, unknown>
      fields: Record<string, unknown>[]
    }
    expect(dec(body.name)).toBe("New Example")
    expect(dec(body.notes)).toBe("made for a test")
    expect(dec(body.login.totp)).toBe("JBSWY3DPEHPK3PXP")
    expect(dec(body.fields[0]?.name)).toBe("Member")
  })

  it("refuses an authenticator key it cannot read, and a folder it does not have", async () => {
    const details = {
      name: "",
      notes: "",
      totp: "",
      customFields: [],
      folderId: null,
    }
    await expect(
      provider().save(VAULT, {
        ...login,
        details: { ...details, totp: "not a key!" },
      }),
    ).rejects.toMatchObject({ code: "invalidCodeKey" })
    await expect(
      provider().save(VAULT, {
        ...login,
        details: { ...details, folderId: "folder-9" },
      }),
    ).rejects.toMatchObject({ code: "notFound" })
    expect(writes()).toEqual([])
  })
})

describe("passReprompt", () => {
  const masterPassword = "test master password"

  beforeEach(async () => {
    // An account key wrapped with a known master password, so the password can be checked.
    await saveAccount({
      id: ACCOUNT_ID,
      userId: "user-1",
      email: "someone@example.com",
      server: SERVER,
      kdf: { type: KdfType.Pbkdf2Sha256, iterations: 5000 },
      // The salt the SDK derived the key with: the email address.
      salt: "someone@example.com",
      wrappedUserKey: sdk.encrypt_user_key_with_master_password(
        userKey,
        masterPassword,
        "someone@example.com",
        { pBKDF2: { iterations: 5000 } },
      ),
      encryptedRefreshToken: "unused",
    })
  })

  it("keeps an item that asks for the master password closed until it is entered", async () => {
    const bw = provider()
    const page = new URL("https://guarded.test/")
    expect((await bw.details(VAULT, "item-6", null)).secretsWithheld).toBe(true)
    await expect(
      bw.passReprompt(VAULT, "item-6", "wrong password"),
    ).rejects.toMatchObject({ code: "bitwarden.wrongPassword" })
    await expect(bw.credential(VAULT, "item-6", page)).rejects.toMatchObject({
      code: "bitwarden.reprompt",
    })
    await bw.passReprompt(VAULT, "item-6", masterPassword)
    expect((await bw.details(VAULT, "item-6", null)).secretsWithheld).toBe(
      false,
    )
    expect((await bw.credential(VAULT, "item-6", page)).password).toBe(
      "{{SECRET_7pyhp5ym}}",
    )
    // The pass opens that item only.
    await expect(
      bw.passReprompt(VAULT, "item-9", masterPassword),
    ).rejects.toMatchObject({ code: "notFound" })
  })

  it("gives no pass when the account locks while the password is checked", async () => {
    const bw = provider()
    const subtle = globalThis.crypto.subtle
    const importKey = subtle.importKey.bind(subtle)
    let locked: Promise<void> | undefined
    // Checking the password stretches the master key with HMAC; the lock comes in the middle.
    const spy = vi
      .spyOn(subtle, "importKey")
      .mockImplementation(async (...args: Parameters<typeof importKey>) => {
        locked ??= bw.lock(VAULT)
        await locked
        return importKey(...args)
      })
    try {
      await expect(
        bw.passReprompt(VAULT, "item-6", masterPassword),
      ).rejects.toMatchObject({ code: "locked" })
    } finally {
      spy.mockRestore()
    }
    const passes = await fakeBrowser.storage.session.get(
      "bitwarden.repromptPasses",
    )
    expect(passes["bitwarden.repromptPasses"] ?? {}).toEqual({})
  })

  it("lets the pass run out", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    try {
      const bw = provider()
      await bw.passReprompt(VAULT, "item-6", masterPassword)
      vi.advanceTimersByTime(6 * 60_000)
      expect((await bw.details(VAULT, "item-6", null)).secretsWithheld).toBe(
        true,
      )
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("trash", () => {
  it("lists trashed items apart from the vault's items", async () => {
    const { logins, trashed } = await provider().allItems(VAULT)
    expect(logins.map((login) => login.id)).not.toContain("item-4")
    expect(trashed).toEqual([
      expect.objectContaining({
        id: "item-4",
        kind: "login",
        name: "Thrown Away",
        username: "former",
        host: "old.example.com",
        deletedAt: Date.parse("2026-11-01T08:00:00.000Z"),
        editable: true,
      }),
      expect.objectContaining({ id: "item-5", editable: false }),
    ])
  })

  it("restores an item and deletes one for good", async () => {
    const bw = provider()
    await bw.restore(VAULT, "item-4")
    await bw.purge(VAULT, "item-4")
    expect(writes().map((write) => [write.method, write.url])).toEqual([
      ["PUT", `${SERVER}/api/ciphers/item-4/restore`],
      ["DELETE", `${SERVER}/api/ciphers/item-4`],
    ])
  })

  it("leaves read-only items and items outside the trash alone", async () => {
    const bw = provider()
    await expect(bw.purge(VAULT, "item-5")).rejects.toMatchObject({
      code: "notEditable",
    })
    await expect(bw.purge(VAULT, "item-1")).rejects.toMatchObject({
      code: "notFound",
    })
    expect(writes()).toEqual([])
  })

  it("shows a trashed item's details in the popup without offering it to pages or edits", async () => {
    const bw = provider()
    const details = await bw.details(VAULT, "item-4", null)
    expect(details).toMatchObject({
      name: "Thrown Away",
      username: "former",
      uris: ["https://old.example.com"],
      editable: false,
      favorite: undefined,
    })
    await expect(
      bw.details(VAULT, "item-4", new URL("https://old.example.com")),
    ).rejects.toMatchObject({ code: "notFound" })
    await expect(
      bw.edit(VAULT, "item-4", { name: "Changed" }),
    ).rejects.toMatchObject({ code: "notEditable" })
    await expect(bw.setFavorite(VAULT, "item-4", true)).rejects.toMatchObject({
      code: "notEditable",
    })
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

describe("several accounts used at once", () => {
  const OTHER_ACCOUNT_ID = accountIdOf(SERVER, "user-2")
  const OTHER_VAULT = vaultIdOf(OTHER_ACCOUNT_ID)

  /** Both accounts unlocked with access tokens that must be refreshed before use. */
  async function twoAccountsDueForRefresh() {
    const data = { Profile: {}, Ciphers: ciphers }
    for (const [accountId, userId] of [
      [ACCOUNT_ID, "user-1"],
      [OTHER_ACCOUNT_ID, "user-2"],
    ] as const) {
      await saveAccount({
        id: accountId,
        userId,
        email: `${userId}@example.com`,
        server: SERVER,
        kdf: { type: KdfType.Pbkdf2Sha256, iterations: 5000 },
        salt: "",
        wrappedUserKey: "unused",
        encryptedRefreshToken: enc(`refresh-${userId}`),
      })
      await saveSession(accountId, {
        userKey: userKey.toBase64(),
        accessToken: "",
        accessTokenExpiresAt: 0,
        refreshToken: `refresh-${userId}`,
      })
      await saveSync(accountId, { syncedAt: Date.now(), data })
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        if (url.endsWith("/connect/token")) {
          const used = new URLSearchParams(init.body as URLSearchParams).get(
            "refresh_token",
          )
          return Response.json({
            access_token: `access-for-${used}`,
            refresh_token: `rotated-${used}`,
            expires_in: 3600,
          })
        }
        return Response.json(url.includes("/sync") ? data : {})
      }),
    )
  }

  it("keeps each account's rotated refresh token", async () => {
    await twoAccountsDueForRefresh()
    const bw = provider()
    await Promise.all([bw.sync(ACCOUNT_ID), bw.sync(OTHER_ACCOUNT_ID)])
    const tokens = (await loadAccounts()).map((account) => [
      account.userId,
      dec(account.encryptedRefreshToken),
    ])
    expect(Object.fromEntries(tokens)).toEqual({
      "user-1": "rotated-refresh-user-1",
      "user-2": "rotated-refresh-user-2",
    })
  })

  it("counts both accounts as used, so neither locks as idle", async () => {
    await twoAccountsDueForRefresh()
    vi.useFakeTimers({ toFake: ["Date"] })
    try {
      const bw = provider()
      const page = new URL("https://example.com/")
      await Promise.all([bw.logins(VAULT, page), bw.logins(OTHER_VAULT, page)])
      vi.advanceTimersByTime(30_000)
      await bw.lockIdle(1)
      const statuses = (await bw.vaults()).map((vault) => vault.status)
      expect(statuses).toEqual(["ready", "ready"])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("locking during a sync", () => {
  it("keeps the synced data out of the session once the account is locked", async () => {
    let requested: () => void = () => {}
    const requestSent = new Promise<void>((resolve) => {
      requested = resolve
    })
    let answer: () => void = () => {}
    const answered = new Promise<void>((resolve) => {
      answer = resolve
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        requested()
        await answered
        return Response.json({ Profile: {}, Ciphers: ciphers })
      }),
    )
    const bw = provider()
    const syncing = bw.sync(ACCOUNT_ID)
    // Locked while the server is answering, after the sync has read the session.
    await requestSent
    await bw.lock(VAULT)
    answer()
    await expect(syncing).rejects.toMatchObject({ code: "locked" })
    expect(await loadSync(ACCOUNT_ID)).toBeNull()
  })
})

describe("logins Keyward may not change", () => {
  it("are found as kept but not editable, and refuse an update", async () => {
    const bw = provider()
    const example = new URL("https://example.com/")
    expect(
      await bw.findExisting(VAULT, example, "reader", "new password"),
    ).toMatchObject({ loginId: "item-3", editable: false })
    expect(
      await bw.findExisting(
        VAULT,
        new URL("https://guarded.test/"),
        "careful",
        "new password",
      ),
    ).toMatchObject({ loginId: "item-6", editable: false })
    expect(
      await bw.findExisting(VAULT, example, "someone@example.com", "x"),
    ).toMatchObject({ loginId: "item-1", editable: true })
    await expect(
      bw.update(VAULT, "item-3", {
        url: example,
        username: "reader",
        password: "new password",
      }),
    ).rejects.toMatchObject({ code: "notEditable" })
    expect(writes()).toEqual([])
  })
})

describe("reading an unlocked account", () => {
  it("lists vaults and decrypted logins again without reading the synced data", async () => {
    const bw = provider()
    const page = new URL("https://example.com/")
    await bw.logins(VAULT, page)
    const read = vi.spyOn(fakeBrowser.storage.session, "get")
    await bw.logins(VAULT, page)
    await bw.vaults()
    const keysRead = read.mock.calls
      .flatMap(([keys]) => (Array.isArray(keys) ? keys : [keys]))
      .filter((key): key is string => typeof key === "string")
    expect(keysRead.some((key) => key.startsWith("bitwarden.sync."))).toBe(
      false,
    )
  })
})

describe("signOut", () => {
  it("tells listeners, so the toolbar and pages follow", async () => {
    const bw = provider()
    const listener = vi.fn()
    bw.onChange(listener)
    await bw.signOut(ACCOUNT_ID)
    expect(listener).toHaveBeenCalled()
    expect(await bw.vaults()).toEqual([])
  })
})

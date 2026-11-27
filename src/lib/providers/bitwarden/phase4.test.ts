import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import {
  folderSubtreeIds,
  nestedFolderChoices,
} from "@/components/keyward/folder-tree"
import { accountIdOf } from "./account-store"
import { BitwardenProvider } from "./bitwarden-provider"
import { sdk, seedUnlockedAccount, testVaultCrypto } from "./test-sdk"
import { vaultIdOf } from "./vault-id"

const SERVER = "https://vault.example.test"
const ACCOUNT_ID = accountIdOf(SERVER, "user-p4")
const VAULT = vaultIdOf(ACCOUNT_ID)

const userKey = sdk.make_user_key_aes256_cbc_hmac()
const orgKey = sdk.make_user_key_aes256_cbc_hmac()
const privateKey = sdk.rsa_generate_keypair()
const encUser = (text: string) => sdk.symmetric_encrypt_string(text, userKey)
const decUser = (value: unknown) =>
  sdk.symmetric_decrypt_string(String(value), userKey)
const encOrg = (text: string) => sdk.symmetric_encrypt_string(text, orgKey)
const decOrg = (value: unknown) =>
  sdk.symmetric_decrypt_string(String(value), orgKey)

const syncData = {
  Profile: {
    PrivateKey: sdk.wrap_decapsulation_key(privateKey, userKey),
    Organizations: [
      {
        Id: "org-1",
        Name: "Acme Corp",
        Key: sdk.encapsulate_key_unsigned(
          orgKey,
          sdk.rsa_extract_public_key(privateKey),
        ),
      },
    ],
  },
  Folders: [
    { Id: "f-root", Name: encUser("Work") },
    { Id: "f-child", Name: encUser("Work/Infra") },
  ],
  Collections: [
    {
      Id: "col-eng",
      OrganizationId: "org-1",
      Name: encOrg("Engineering"),
    },
    {
      Id: "col-ops",
      OrganizationId: "org-1",
      Name: encOrg("Operations"),
    },
  ],
  Ciphers: [
    {
      Id: "login-1",
      Type: 1,
      Edit: true,
      Reprompt: 0,
      FolderId: "f-root",
      Name: encUser("Portal"),
      Notes: encUser("old note"),
      Login: {
        Username: encUser("alice"),
        Password: encUser("pw-1"),
        Uris: [{ Uri: encUser("https://portal.example"), Match: null }],
        Fido2Credentials: [{ CredentialId: "pk-1" }],
      },
      PasswordHistory: [
        { Password: encUser("older"), LastUsedDate: "2025-01-01T00:00:00Z" },
      ],
    },
    {
      Id: "note-1",
      Type: 2,
      Edit: true,
      Reprompt: 0,
      FolderId: null,
      Name: encUser("Runbook"),
      Notes: encUser("step 1"),
      SecureNote: { Type: 0 },
    },
    {
      Id: "archived-1",
      Type: 1,
      Edit: true,
      Reprompt: 0,
      ArchivedDate: "2026-10-01T00:00:00.000Z",
      Name: encUser("Legacy App"),
      Login: {
        Username: encUser("olduser"),
        Password: encUser("oldpw"),
        Uris: [{ Uri: encUser("https://legacy.example"), Match: null }],
      },
    },
  ],
}

const requests: { method: string; url: string; body: unknown }[] = []

beforeEach(async () => {
  fakeBrowser.reset()
  requests.length = 0
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init: RequestInit = {}) => {
      const target = String(url)
      const method = init.method ?? "GET"
      const body = typeof init.body === "string" ? JSON.parse(init.body) : null
      requests.push({ method, url: target, body })
      if (method === "DELETE") return new Response(null, { status: 200 })
      if (target.endsWith("/folders") && method === "POST")
        return Response.json({
          Id: "f-new",
          Name: (body as { name: string }).name,
        })
      if (target.includes("/sync")) return Response.json(syncData)
      return Response.json({})
    }),
  )
  await seedUnlockedAccount({
    server: SERVER,
    userId: "user-p4",
    email: "p4@example.test",
    userKey,
    syncData,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("Phase 4: nested folders, folder CRUD, organizations, reprompt, clone, and archive", () => {
  it("formats slash-delimited folders as a sorted nested tree and matches descendants", () => {
    const folders = [
      { id: "3", name: "Work/Infra/Prod" },
      { id: "1", name: "Personal" },
      { id: "2", name: "Work" },
      { id: "4", name: "Work/Infra" },
    ]
    const choices = nestedFolderChoices(folders)
    expect(choices.map((c) => [c.id, c.depth, c.leafName])).toEqual([
      ["1", 0, "Personal"],
      ["2", 0, "Work"],
      ["4", 1, "Infra"],
      ["3", 2, "Prod"],
    ])
    expect(folderSubtreeIds(folders, "2")).toEqual(new Set(["2", "4", "3"]))
    expect(folderSubtreeIds(folders, "4")).toEqual(new Set(["4", "3"]))
  })

  it("supports folder create, rename, and delete with user-key encryption", async () => {
    const provider = new BitwardenProvider(async () => testVaultCrypto)
    const created = await provider.createFolder(VAULT, "Work/Finance")
    expect(created).toEqual({ id: "f-new", name: "Work/Finance" })
    const post = requests.find(
      (r) => r.method === "POST" && r.url.endsWith("/folders"),
    )
    expect(decUser((post?.body as { name: string } | undefined)?.name)).toBe(
      "Work/Finance",
    )

    await provider.renameFolder(VAULT, "f-root", "Company")
    const put = requests.find(
      (r) => r.method === "PUT" && r.url.endsWith("/folders/f-root"),
    )
    expect(decUser((put?.body as { name: string } | undefined)?.name)).toBe(
      "Company",
    )

    await provider.deleteFolder(VAULT, "f-child")
    expect(
      requests.some(
        (r) => r.method === "DELETE" && r.url.endsWith("/folders/f-child"),
      ),
    ).toBe(true)
  })

  it("creates organization logins and notes encrypted with the org key and collectionIds", async () => {
    const provider = new BitwardenProvider(async () => testVaultCrypto)
    await provider.save(VAULT, {
      url: new URL("https://org.example"),
      username: "ops",
      password: "org-password",
      details: {
        name: "Org App",
        notes: "shared",
        totp: "",
        customFields: [],
        folderId: "f-root",
        reprompt: true,
        organizationId: "org-1",
        collectionIds: ["col-eng", "col-ops"],
      },
    })
    const req = requests.find(
      (r) => r.method === "POST" && r.url.endsWith("/ciphers/create"),
    )
    expect(req).toBeDefined()
    const payload = req?.body as {
      cipher: Record<string, unknown>
      collectionIds: string[]
    }
    expect(payload.collectionIds).toEqual(["col-eng", "col-ops"])
    expect(payload.cipher.organizationId).toBe("org-1")
    expect(payload.cipher.reprompt).toBe(1)
    expect(decOrg(payload.cipher.name)).toBe("Org App")
    expect(
      decOrg((payload.cipher.login as Record<string, unknown>).password),
    ).toBe("org-password")

    // Creating an org item without any collection is rejected.
    await expect(
      provider.saveNote(VAULT, {
        name: "Bad Org Note",
        text: "body",
        customFields: [],
        organizationId: "org-1",
        collectionIds: [],
      }),
    ).rejects.toMatchObject({ code: "invalidInput" })
  })

  it("edits login and note folderId and reprompt", async () => {
    const provider = new BitwardenProvider(async () => testVaultCrypto)
    await provider.edit(VAULT, "login-1", {
      folderId: "f-child",
      reprompt: true,
    })
    const loginPut = requests.find(
      (r) => r.method === "PUT" && r.url.endsWith("/ciphers/login-1"),
    )
    expect(loginPut?.body).toMatchObject({ folderId: "f-child", reprompt: 1 })

    await provider.editNote(VAULT, "note-1", {
      name: "Runbook",
      text: "step 1",
      customFields: [],
      folderId: "f-root",
      reprompt: true,
    })
    const notePut = requests.find(
      (r) => r.method === "PUT" && r.url.endsWith("/ciphers/note-1"),
    )
    expect(notePut?.body).toMatchObject({ folderId: "f-root", reprompt: 1 })
  })

  it("clones an item while stripping passkeys and password history", async () => {
    const provider = new BitwardenProvider(async () => testVaultCrypto)
    await provider.clone(VAULT, "login-1")
    const req = requests.find(
      (r) => r.method === "POST" && r.url.endsWith("/ciphers"),
    )
    const body = req?.body as Record<string, unknown>
    expect(decUser(body.name)).toBe("Portal - Clone")
    expect(body.passwordHistory).toBeUndefined()
    expect(
      (body.login as Record<string, unknown>).fido2Credentials,
    ).toBeUndefined()
  })

  it("lists archived items and supports archive and unarchive", async () => {
    const provider = new BitwardenProvider(async () => testVaultCrypto)
    const all = await provider.allItems(VAULT)
    expect(all.archived?.map((i) => i.id)).toEqual(["archived-1"])
    expect(all.logins.map((i) => i.id)).toEqual(["login-1"])

    await provider.archive(VAULT, "login-1")
    expect(
      requests.some(
        (r) => r.method === "PUT" && r.url.endsWith("/ciphers/login-1/archive"),
      ),
    ).toBe(true)

    await provider.unarchive(VAULT, "archived-1")
    expect(
      requests.some(
        (r) =>
          r.method === "PUT" && r.url.endsWith("/ciphers/archived-1/unarchive"),
      ),
    ).toBe(true)
  })
})

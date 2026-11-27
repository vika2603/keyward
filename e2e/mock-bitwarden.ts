import http from "node:http"
import { createRequire } from "node:module"
import type { PureCrypto } from "@bitwarden/sdk-internal"
import type { StoredPasskey } from "@/lib/passkeys/types"
import {
  KdfType,
  masterKeySalt,
  masterPasswordHash,
  pureCryptoAdapter,
  stretchMasterKey,
} from "@/lib/providers/bitwarden/crypto"

const sdk = createRequire(import.meta.url)(
  "@bitwarden/sdk-internal/node/bitwarden_wasm_internal.js",
).PureCrypto as typeof PureCrypto
const vaultCrypto = pureCryptoAdapter(sdk)

export interface MockBitwardenState {
  ciphers: Record<string, unknown>[]
  folders: { Id: string; Name: string }[]
  collections: { Id: string; OrganizationId: string; Name: string }[]
  organizations: { Id: string; Name: string; Key: string }[]
  equivalentDomains: string[][]
  revisionDate: number
  syncCount: number
  revisionDateChecks: number
}

export interface MockBitwardenServer {
  url: string
  email: string
  masterPassword: string
  userId: string
  userKey: Uint8Array
  wrappedUserKey: string
  encrypt: (text: string) => string | null
  decrypt: (value: unknown) => string
  encryptPasskey: (passkey: StoredPasskey) => Record<string, unknown>
  state: MockBitwardenState
  reset: (seed?: {
    ciphers?: Record<string, unknown>[]
    folders?: { Id: string; Name: string }[]
    equivalentDomains?: string[][]
  }) => void
  close: () => Promise<void>
}

function makeJwt(userId: string): string {
  const header = new TextEncoder()
    .encode(JSON.stringify({ alg: "none", typ: "JWT" }))
    .toBase64({ alphabet: "base64url", omitPadding: true })
  const payload = new TextEncoder()
    .encode(JSON.stringify({ sub: userId }))
    .toBase64({ alphabet: "base64url", omitPadding: true })
  return `${header}.${payload}.mock`
}

async function readBody(request: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString("utf8")
}

function toPascalCipher(
  id: string,
  body: Record<string, unknown>,
  existing?: Record<string, unknown>,
): Record<string, unknown> {
  const now = new Date().toISOString()
  const login = body.login as Record<string, unknown> | undefined
  const secureNote = body.secureNote as Record<string, unknown> | undefined
  const fields = Array.isArray(body.fields)
    ? (body.fields as Record<string, unknown>[]).map((field) => ({
        Type: field.type,
        Name: field.name,
        Value: field.value,
        LinkedId: field.linkedId ?? null,
      }))
    : undefined
  const passwordHistory = Array.isArray(body.passwordHistory)
    ? (body.passwordHistory as Record<string, unknown>[]).map((entry) => ({
        Password: entry.password,
        LastUsedDate: entry.lastUsedDate,
      }))
    : (existing?.PasswordHistory ?? null)

  return {
    ...(existing ?? {}),
    Id: id,
    Type: body.type ?? existing?.Type ?? 1,
    Edit: true,
    Favorite: body.favorite ?? existing?.Favorite ?? false,
    Reprompt: body.reprompt ?? existing?.Reprompt ?? 0,
    FolderId:
      body.folderId !== undefined
        ? body.folderId
        : (existing?.FolderId ?? null),
    OrganizationId:
      body.organizationId !== undefined
        ? body.organizationId
        : (existing?.OrganizationId ?? null),
    CollectionIds: body.collectionIds ?? existing?.CollectionIds ?? [],
    Name: body.name ?? existing?.Name ?? null,
    Notes: body.notes !== undefined ? body.notes : (existing?.Notes ?? null),
    Key: body.key !== undefined ? body.key : (existing?.Key ?? null),
    Fields: fields ?? existing?.Fields ?? [],
    PasswordHistory: passwordHistory,
    CreationDate: existing?.CreationDate ?? now,
    RevisionDate: now,
    ...(login
      ? {
          Login: {
            Username: login.username ?? null,
            Password: login.password ?? null,
            PasswordRevisionDate: login.passwordRevisionDate ?? null,
            Totp: login.totp ?? null,
            AutofillOnPageLoad: login.autofillOnPageLoad ?? null,
            Fido2Credentials: login.fido2Credentials ?? null,
            Uris: Array.isArray(login.uris)
              ? (login.uris as Record<string, unknown>[]).map((uri) => ({
                  Uri: uri.uri ?? null,
                  Match: uri.match ?? null,
                  UriChecksum: uri.uriChecksum ?? null,
                }))
              : [],
          },
        }
      : {}),
    ...(secureNote
      ? {
          SecureNote: {
            Type: secureNote.type ?? 0,
          },
        }
      : {}),
  }
}

/**
 * Starts a local stateful Bitwarden-compatible HTTP server for full-system E2E testing
 * (supports real PBKDF2 sign-in, unlock, sync, revision-date, cipher CRUD, trash, archive, and folders).
 */
export async function startMockBitwarden(options?: {
  email?: string
  masterPassword?: string
  userId?: string
}): Promise<MockBitwardenServer> {
  const email = options?.email ?? "e2e@keyward.test"
  const masterPassword = options?.masterPassword ?? "MasterPass!2026#E2E"
  const userId = options?.userId ?? "user-e2e-bitwarden"
  const kdf = { type: KdfType.Pbkdf2Sha256, iterations: 5000 }

  const userKey = sdk.make_user_key_aes256_cbc_hmac()
  const salt = masterKeySalt(email, null)
  const masterKey = vaultCrypto.deriveMasterKey(masterPassword, salt, kdf)
  const expectedHash = await masterPasswordHash(masterKey, masterPassword)
  const stretched = await stretchMasterKey(masterKey)
  const wrappedUserKey = sdk.wrap_symmetric_key(userKey, stretched)
  const accessToken = makeJwt(userId)

  const encrypt = (text: string): string | null =>
    text ? sdk.symmetric_encrypt_string(text, userKey) : null
  const decrypt = (value: unknown): string =>
    typeof value === "string" && value
      ? sdk.symmetric_decrypt_string(value, userKey)
      : ""

  const encryptPasskey = (passkey: StoredPasskey): Record<string, unknown> => ({
    credentialId: encrypt(passkey.credentialId),
    keyType: encrypt(passkey.keyType),
    keyAlgorithm: encrypt(passkey.keyAlgorithm),
    keyCurve: encrypt(passkey.keyCurve),
    keyValue: encrypt(passkey.keyValue),
    rpId: encrypt(passkey.rpId),
    rpName: encrypt(passkey.rpName),
    userHandle: encrypt(passkey.userHandle),
    userName: encrypt(passkey.userName),
    userDisplayName: encrypt(passkey.userDisplayName),
    counter: encrypt(passkey.counter),
    discoverable: encrypt(passkey.discoverable),
    creationDate: passkey.creationDate,
  })

  const state: MockBitwardenState = {
    ciphers: [],
    folders: [],
    collections: [],
    organizations: [],
    equivalentDomains: [],
    revisionDate: Date.now(),
    syncCount: 0,
    revisionDateChecks: 0,
  }
  let nextCipherSeq = 1
  let nextFolderSeq = 1

  const touchRevision = () => {
    state.revisionDate = Date.now() + 1000
  }

  const sendJson = (
    response: http.ServerResponse,
    status: number,
    payload: unknown,
  ) => {
    response.writeHead(status, { "Content-Type": "application/json" })
    response.end(JSON.stringify(payload))
  }

  const server = http.createServer(async (request, response) => {
    const method = request.method ?? "GET"
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname

    if (pathname === "/identity/accounts/prelogin" && method === "POST") {
      return sendJson(response, 200, {
        kdf: kdf.type,
        kdfIterations: kdf.iterations,
      })
    }

    if (pathname === "/identity/connect/token" && method === "POST") {
      const form = new URLSearchParams(await readBody(request))
      const grantType = form.get("grant_type")
      if (grantType === "password") {
        const sentEmail = (form.get("username") ?? "").trim().toLowerCase()
        const sentHash = form.get("password") ?? ""
        if (sentEmail !== email.toLowerCase() || sentHash !== expectedHash) {
          return sendJson(response, 400, {
            error: "invalid_grant",
            error_description: "invalid_username_or_password",
          })
        }
      }
      return sendJson(response, 200, {
        access_token: accessToken,
        expires_in: 3600,
        token_type: "Bearer",
        refresh_token: "mock-refresh-token",
        Key: wrappedUserKey,
      })
    }

    if (pathname === "/api/accounts/revision-date" && method === "GET") {
      state.revisionDateChecks++
      response.writeHead(200, { "Content-Type": "application/json" })
      response.end(String(state.revisionDate))
      return
    }

    if (pathname === "/api/sync" && method === "GET") {
      state.syncCount++
      return sendJson(response, 200, {
        Profile: {
          Id: userId,
          Email: email,
          Organizations: state.organizations,
        },
        Folders: state.folders,
        Collections: state.collections,
        Ciphers: state.ciphers,
        Domains: {
          EquivalentDomains: state.equivalentDomains,
          GlobalEquivalentDomains: [],
        },
      })
    }

    if (
      (pathname === "/api/ciphers" || pathname === "/api/ciphers/create") &&
      method === "POST"
    ) {
      const raw = JSON.parse(await readBody(request)) as Record<string, unknown>
      const cipherBody =
        pathname === "/api/ciphers/create"
          ? {
              ...(raw.cipher as Record<string, unknown>),
              collectionIds: raw.collectionIds,
            }
          : raw
      const id = `cipher-created-${nextCipherSeq++}`
      const created = toPascalCipher(id, cipherBody)
      state.ciphers.push(created)
      touchRevision()
      return sendJson(response, 200, created)
    }

    const cipherMatch = pathname.match(/^\/api\/ciphers\/([^/]+)(\/(.+))?$/)
    if (cipherMatch) {
      const id = decodeURIComponent(cipherMatch[1] ?? "")
      const action = cipherMatch[3] ?? ""
      const index = state.ciphers.findIndex((cipher) => cipher.Id === id)
      if (index < 0) return sendJson(response, 404, { message: "Not found" })
      const current = state.ciphers[index]
      if (!current) return sendJson(response, 404, { message: "Not found" })

      if (!action && method === "PUT") {
        const body = JSON.parse(await readBody(request)) as Record<
          string,
          unknown
        >
        const updated = toPascalCipher(id, body, current)
        state.ciphers[index] = updated
        touchRevision()
        return sendJson(response, 200, updated)
      }
      if (action === "partial" && method === "PUT") {
        const body = JSON.parse(await readBody(request)) as {
          folderId?: string | null
          favorite?: boolean
        }
        state.ciphers[index] = {
          ...current,
          FolderId: body.folderId ?? null,
          Favorite: Boolean(body.favorite),
        }
        touchRevision()
        return sendJson(response, 200, state.ciphers[index])
      }
      if (action === "delete" && method === "PUT") {
        state.ciphers[index] = {
          ...current,
          DeletedDate: new Date().toISOString(),
        }
        touchRevision()
        response.writeHead(200)
        response.end()
        return
      }
      if (action === "restore" && method === "PUT") {
        const { DeletedDate: _removed, ...rest } = current
        state.ciphers[index] = rest
        touchRevision()
        return sendJson(response, 200, rest)
      }
      if (action === "archive" && method === "PUT") {
        state.ciphers[index] = {
          ...current,
          ArchivedDate: new Date().toISOString(),
        }
        touchRevision()
        return sendJson(response, 200, state.ciphers[index])
      }
      if (action === "unarchive" && method === "PUT") {
        const { ArchivedDate: _removed, ...rest } = current
        state.ciphers[index] = rest
        touchRevision()
        return sendJson(response, 200, rest)
      }
      if (!action && method === "DELETE") {
        state.ciphers.splice(index, 1)
        touchRevision()
        response.writeHead(200)
        response.end()
        return
      }
    }

    if (pathname === "/api/folders" && method === "POST") {
      const body = JSON.parse(await readBody(request)) as { name: string }
      const folder = {
        Id: `folder-created-${nextFolderSeq++}`,
        Name: body.name,
      }
      state.folders.push(folder)
      touchRevision()
      return sendJson(response, 200, folder)
    }

    const folderMatch = pathname.match(/^\/api\/folders\/([^/]+)$/)
    if (folderMatch) {
      const id = decodeURIComponent(folderMatch[1] ?? "")
      const index = state.folders.findIndex((folder) => folder.Id === id)
      if (index < 0) return sendJson(response, 404, { message: "Not found" })
      if (method === "PUT") {
        const body = JSON.parse(await readBody(request)) as { name: string }
        state.folders[index] = { Id: id, Name: body.name }
        touchRevision()
        return sendJson(response, 200, state.folders[index])
      }
      if (method === "DELETE") {
        state.folders.splice(index, 1)
        for (const cipher of state.ciphers) {
          if (cipher.FolderId === id) cipher.FolderId = null
        }
        touchRevision()
        response.writeHead(200)
        response.end()
        return
      }
    }

    response.writeHead(404)
    response.end("Not Found")
  })

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === "string")
    throw new Error("Could not bind mock Bitwarden server")

  return {
    url: `http://127.0.0.1:${address.port}`,
    email,
    masterPassword,
    userId,
    userKey,
    wrappedUserKey,
    encrypt,
    decrypt,
    encryptPasskey,
    state,
    reset(seed) {
      state.ciphers = seed?.ciphers ? [...seed.ciphers] : []
      state.folders = seed?.folders ? [...seed.folders] : []
      state.equivalentDomains = seed?.equivalentDomains
        ? [...seed.equivalentDomains]
        : []
      state.syncCount = 0
      state.revisionDateChecks = 0
      state.revisionDate = Date.now()
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
  }
}

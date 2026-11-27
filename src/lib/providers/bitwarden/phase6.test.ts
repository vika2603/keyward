import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { PasskeyPrompt } from "@/background/passkey-prompt"
import {
  COSE_ALG_ES256,
  credentialIdBase64Url,
  toBase64Url,
} from "@/lib/passkeys/webauthn"
import { accountIdOf } from "./account-store"
import { BitwardenProvider } from "./bitwarden-provider"
import { decryptFido2Credentials } from "./decrypt"
import { VaultKeys } from "./keys"
import { sdk, seedUnlockedAccount, testVaultCrypto } from "./test-sdk"
import { vaultIdOf } from "./vault-id"

vi.mock("@/background/page", () => ({
  frameUrl: vi.fn(async () => new URL("https://example.com/login")),
}))

const SERVER = "https://vault.example.test"
const ACCOUNT_ID = accountIdOf(SERVER, "user-p6")
const VAULT = vaultIdOf(ACCOUNT_ID)

const userKey = sdk.make_user_key_aes256_cbc_hmac()
const encUser = (text: string) => sdk.symmetric_encrypt_string(text, userKey)

function makeSync(ciphers: Record<string, unknown>[]) {
  return {
    Profile: { Organizations: [] },
    Folders: [],
    Collections: [],
    Ciphers: ciphers,
  }
}

describe("Phase 6: Bitwarden Fido2Credentials & PasskeyPrompt coexistence", () => {
  let ciphers: Record<string, unknown>[]
  let provider: BitwardenProvider

  beforeEach(async () => {
    fakeBrowser.reset()
    ciphers = [
      {
        Id: "login-1",
        Type: 1,
        Edit: true,
        Reprompt: 0,
        Name: encUser("Example"),
        Login: {
          Username: encUser("alice@example.com"),
          Password: encUser("secret"),
          Uris: [{ Uri: encUser("https://example.com"), Match: null }],
        },
      },
    ]

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init: RequestInit = {}) => {
        const target = String(url)
        const method = init.method ?? "GET"
        const body =
          typeof init.body === "string"
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : null

        if (target.endsWith("/ciphers") && method === "POST" && body) {
          const created = {
            Id: `cipher-${ciphers.length + 1}`,
            Type: body.type,
            Edit: true,
            Reprompt: 0,
            Name: body.name,
            Login: {
              Username: (body.login as Record<string, unknown>).username,
              Password: (body.login as Record<string, unknown>).password,
              Uris: (body.login as Record<string, unknown>).uris,
              Fido2Credentials: (body.login as Record<string, unknown>)
                .fido2Credentials,
            },
          }
          ciphers.push(created)
          return Response.json(created)
        }
        if (target.includes("/ciphers/") && method === "PUT" && body) {
          const id = target.split("/").pop()
          const index = ciphers.findIndex((c) => c.Id === id)
          if (index >= 0) {
            ciphers[index] = {
              ...ciphers[index],
              Name: body.name,
              Login: {
                ...(ciphers[index]?.Login as Record<string, unknown>),
                Fido2Credentials: (body.login as Record<string, unknown>)
                  .fido2Credentials,
              },
            }
          }
          return Response.json(ciphers[index] ?? {})
        }
        if (target.includes("/sync")) return Response.json(makeSync(ciphers))
        return Response.json({})
      }),
    )

    provider = new BitwardenProvider(async () => testVaultCrypto)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function seedUnlockedBitwarden() {
    await seedUnlockedAccount({
      server: SERVER,
      userId: "user-p6",
      email: "alice@example.test",
      userKey,
      syncData: makeSync(ciphers),
    })
  }

  it("creates, encrypts, decrypts, lists, and signs Bitwarden passkeys and enforces excludeCredentials", async () => {
    await seedUnlockedBitwarden()

    const challenge = toBase64Url(new Uint8Array([1, 2, 3, 4]))
    const userId = toBase64Url(new TextEncoder().encode("uid-alice"))

    // Attach a new passkey to existing login-1.
    const created = await provider.createPasskey(VAULT, "login-1", {
      rpId: "example.com",
      rpName: "Example",
      challenge,
      userId,
      userName: "alice@example.com",
      userDisplayName: "Alice",
      pubKeyCredParams: [COSE_ALG_ES256],
      excludeCredentials: [],
      origin: "https://example.com",
      crossOrigin: false,
    })

    expect(created.id).toBeTruthy()
    const { passkeys } = await provider.passkeysForRp("example.com")
    expect(passkeys).toHaveLength(1)
    const firstPasskey = passkeys[0]
    expect(firstPasskey?.userName).toBe("alice@example.com")
    expect(credentialIdBase64Url(firstPasskey?.credentialId ?? "")).toBe(
      created.id,
    )

    // Verify Fido2Credentials are stored encrypted in the cipher and decrypt cleanly.
    const firstCipher = ciphers[0]
    expect(firstCipher).toBeDefined()
    const rawLogin = firstCipher?.Login as Record<string, unknown>
    const rawFido = (rawLogin.Fido2Credentials as Record<string, unknown>[])[0]
    expect(String(rawFido?.keyValue)).toMatch(/^2\./)
    const decrypted = decryptFido2Credentials(
      firstCipher ?? {},
      VaultKeys.fromProfile(testVaultCrypto, userKey, {}),
    )
    expect(decrypted).toHaveLength(1)
    expect(decrypted[0]?.rpId).toBe("example.com")

    // Sign an assertion using the stored Bitwarden passkey.
    const assertion = await provider.signPasskey(
      VAULT,
      "login-1",
      firstPasskey?.credentialId ?? "",
      {
        rpId: "example.com",
        challenge,
        allowCredentials: [{ type: "public-key", id: created.id }],
        origin: "https://example.com",
        crossOrigin: false,
      },
    )
    expect(assertion.id).toBe(created.id)
    expect(assertion.response.signature).toBeTruthy()

    // Attempting to re-register with excludeCredentials fails cleanly.
    await expect(
      provider.createPasskey(VAULT, null, {
        rpId: "example.com",
        rpName: "Example",
        challenge,
        userId,
        userName: "alice@example.com",
        userDisplayName: "Alice",
        pubKeyCredParams: [COSE_ALG_ES256],
        excludeCredentials: [{ type: "public-key", id: created.id }],
        origin: "https://example.com",
        crossOrigin: false,
      }),
    ).rejects.toMatchObject({ code: "invalidInput" })
  })

  it("passes pure Apple Passwords users straight through to native WebAuthn without opening popup", async () => {
    const openChooser = vi.fn(async () => {})
    const prompt = new PasskeyPrompt(provider, openChooser)

    // Zero Bitwarden accounts configured -> immediate native fallback.
    const getOutcome = await prompt.handleGet(1, 0, "req-1", {
      rpId: "example.com",
      challenge: "AAAA",
      allowCredentials: [],
      origin: "https://example.com",
      crossOrigin: false,
    })
    expect(getOutcome).toEqual({ kind: "fallback" })

    const createOutcome = await prompt.handleCreate(1, 0, "req-2", {
      rpId: "example.com",
      rpName: "Example",
      challenge: "AAAA",
      userId: "BBBB",
      userName: "alice",
      userDisplayName: "Alice",
      pubKeyCredParams: [COSE_ALG_ES256],
      excludeCredentials: [],
      origin: "https://example.com",
      crossOrigin: false,
    })
    expect(createOutcome).toEqual({ kind: "fallback" })
    expect(openChooser).not.toHaveBeenCalled()
  })

  it("falls back automatically when Bitwarden has no matching passkey, and supports one-click system fallback", async () => {
    await seedUnlockedBitwarden()
    const openChooser = vi.fn(async () => {})
    const prompt = new PasskeyPrompt(provider, openChooser)

    // Unlocked Bitwarden has no passkeys for example.com yet -> immediate fallback to Apple Passwords / hardware key.
    const noMatch = await prompt.handleGet(1, 0, "req-none", {
      rpId: "example.com",
      challenge: "AAAA",
      allowCredentials: [],
      origin: "https://example.com",
      crossOrigin: false,
    })
    expect(noMatch).toEqual({ kind: "fallback" })
    expect(openChooser).not.toHaveBeenCalled()

    // Spoofed RP ID is rejected with SecurityError.
    const spoofed = await prompt.handleGet(1, 0, "req-spoof", {
      rpId: "evil.com",
      challenge: "AAAA",
      allowCredentials: [],
      origin: "https://example.com",
      crossOrigin: false,
    })
    expect(spoofed).toMatchObject({ kind: "error", name: "SecurityError" })

    // Create flow opens popup and supports explicit one-click system fallback.
    const pendingCreate = prompt.handleCreate(1, 0, "req-create", {
      rpId: "example.com",
      rpName: "Example",
      challenge: "AAAA",
      userId: "BBBB",
      userName: "alice",
      userDisplayName: "Alice",
      pubKeyCredParams: [COSE_ALG_ES256],
      excludeCredentials: [],
      origin: "https://example.com",
      crossOrigin: false,
    })
    // Wait a microtask for popup open.
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(openChooser).toHaveBeenCalledTimes(1)
    prompt.showing()
    const view = await prompt.view()
    expect(view?.kind).toBe("create")
    expect(view?.saveTargets).toHaveLength(1)
    expect(view?.saveTargets[0]?.existingLogins[0]?.id).toBe("login-1")

    prompt.fallback()
    expect(await pendingCreate).toEqual({ kind: "fallback" })
  })
})

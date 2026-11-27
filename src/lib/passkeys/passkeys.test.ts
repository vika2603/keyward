import { describe, expect, it } from "vitest"
import { cborDecode, cborEncode } from "./cbor"
import {
  assertPasskeyCredential,
  COSE_ALG_ES256,
  createPasskeyCredential,
  credentialIdBase64Url,
  derSignatureFromP1363,
  fromBase64Url,
  isValidRpId,
  p1363FromDerSignature,
  toBase64Url,
} from "./webauthn"

describe("CBOR encoder/decoder", () => {
  it("round-trips integers, negative integers, bytes, strings, arrays, maps, and COSE keys", () => {
    const sample = new Map<number | string, unknown>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, new Uint8Array([1, 2, 3, 4])],
      [-3, new Uint8Array(32).fill(0xab)],
    ])
    const encoded = cborEncode(sample as never)
    const decoded = cborDecode(encoded) as Map<number, unknown>
    expect(decoded.get(1)).toBe(2)
    expect(decoded.get(3)).toBe(-7)
    expect(decoded.get(-1)).toBe(1)
    expect(decoded.get(-2)).toEqual(new Uint8Array([1, 2, 3, 4]))
    expect(decoded.get(-3)).toEqual(new Uint8Array(32).fill(0xab))

    const nested = cborEncode({
      fmt: "none",
      attStmt: {},
      authData: new Uint8Array(64).fill(7),
      flags: [true, false, null, 0, 24, 300, 70000, -1000],
    })
    const decodedNested = cborDecode(nested) as Map<string, unknown>
    expect(decodedNested.get("fmt")).toBe("none")
    expect((decodedNested.get("attStmt") as Map<string, unknown>).size).toBe(0)
    expect(decodedNested.get("authData")).toEqual(new Uint8Array(64).fill(7))
    expect(decodedNested.get("flags")).toEqual([
      true,
      false,
      null,
      0,
      24,
      300,
      70000,
      -1000,
    ])
  })
})

describe("RP ID validation", () => {
  it("validates RP IDs strictly per WebAuthn origin rules", () => {
    expect(isValidRpId("github.com", "https://github.com")).toBe(true)
    expect(isValidRpId("github.com", "https://login.github.com")).toBe(true)
    expect(isValidRpId("localhost", "http://localhost:3000")).toBe(true)
    expect(isValidRpId("127.0.0.1", "http://127.0.0.1:8080")).toBe(true)

    // Public suffixes, cross-origin, non-HTTPS, and non-loopback IPs are rejected.
    expect(isValidRpId("com", "https://github.com")).toBe(false)
    expect(isValidRpId("co.uk", "https://bank.co.uk")).toBe(false)
    expect(isValidRpId("evil.com", "https://github.com")).toBe(false)
    expect(isValidRpId("github.com", "http://github.com")).toBe(false)
    expect(isValidRpId("192.168.1.1", "https://192.168.1.1")).toBe(false)
  })
})

describe("WebAuthn ECDSA P-256 authenticator", () => {
  it("creates a P-256 passkey and produces a cryptographically verifiable DER assertion", async () => {
    const createChallenge = toBase64Url(
      new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
    )
    const userId = toBase64Url(new TextEncoder().encode("user-42"))

    const { stored, credential: created } = await createPasskeyCredential({
      rpId: "example.com",
      rpName: "Example",
      challenge: createChallenge,
      userId,
      userName: "alice@example.com",
      userDisplayName: "Alice",
      pubKeyCredParams: [COSE_ALG_ES256, -257],
      excludeCredentials: [],
      residentKey: "required",
      origin: "https://login.example.com",
      crossOrigin: false,
    })

    expect(stored.keyAlgorithm).toBe("ECDSA")
    expect(stored.keyCurve).toBe("P-256")
    expect(stored.rpId).toBe("example.com")
    expect(created.id).toBe(credentialIdBase64Url(stored.credentialId))
    expect(created.response.publicKeyAlgorithm).toBe(-7)

    // Verify attestationObject structure via CBOR decode.
    const attestation = cborDecode(
      fromBase64Url(created.response.attestationObject),
    ) as Map<string, unknown>
    expect(attestation.get("fmt")).toBe("none")
    const authDataCreate = attestation.get("authData") as Uint8Array
    // UP | UV | BE | BS | AT = 0x5d
    expect(authDataCreate[32]).toBe(0x5d)

    // Verify clientDataJSON for create.
    const createClientData = JSON.parse(
      new TextDecoder().decode(fromBase64Url(created.response.clientDataJSON)),
    ) as Record<string, unknown>
    expect(createClientData).toEqual({
      type: "webauthn.create",
      challenge: createChallenge,
      origin: "https://login.example.com",
      crossOrigin: false,
    })

    // Assert with a new challenge and cryptographically verify the DER signature using the SPKI public key.
    const getChallenge = toBase64Url(new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2]))
    const { credential: asserted } = await assertPasskeyCredential(stored, {
      rpId: "example.com",
      challenge: getChallenge,
      allowCredentials: [],
      origin: "https://example.com",
      crossOrigin: false,
    })

    expect(asserted.id).toBe(created.id)
    expect(asserted.response.userHandle).toBe(userId)

    const publicKey = await crypto.subtle.importKey(
      "spki",
      fromBase64Url(created.response.publicKey),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    )
    const authDataGet = fromBase64Url(asserted.response.authenticatorData)
    const clientDataGet = fromBase64Url(asserted.response.clientDataJSON)
    const clientDataHash = new Uint8Array(
      await crypto.subtle.digest("SHA-256", clientDataGet),
    )
    const signedData = new Uint8Array(
      authDataGet.length + clientDataHash.length,
    )
    signedData.set(authDataGet, 0)
    signedData.set(clientDataHash, authDataGet.length)

    const derSig = fromBase64Url(asserted.response.signature)
    expect(derSig[0]).toBe(0x30)
    const p1363Sig = p1363FromDerSignature(derSig)
    // Round-trip DER encoding check.
    expect(derSignatureFromP1363(p1363Sig)).toEqual(derSig)

    const verified = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      p1363Sig,
      signedData,
    )
    expect(verified).toBe(true)
  })

  it("rejects unsupported algorithms when ES256 is not accepted", async () => {
    await expect(
      createPasskeyCredential({
        rpId: "example.com",
        rpName: "Example",
        challenge: "AAAA",
        userId: "BBBB",
        userName: "alice",
        userDisplayName: "Alice",
        pubKeyCredParams: [-257],
        excludeCredentials: [],
        origin: "https://example.com",
        crossOrigin: false,
      }),
    ).rejects.toMatchObject({ name: "NotSupportedError" })
  })
})

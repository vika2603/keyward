import { describe, expect, it } from "vitest"
import {
  bigIntToBytes,
  bytesToBigInt,
  concat,
  fromUtf8,
  randomBytes,
  sha256,
  utf8,
} from "@/lib/bytes"
import { SecureSession } from "./protocol"
import {
  BinaryCodec,
  modPow,
  SRP_GROUP,
  SrpClient,
  verifyServerProof,
} from "./srp"

const { N, g, length } = SRP_GROUP

/** The helper's side of the handshake, written from RFC 5054 and RFC 2945. */
async function serverHandshake(username: string, pin: string, A: bigint) {
  const salt = randomBytes(16)
  const x = bytesToBigInt(
    await sha256(salt, await sha256(utf8(`${username}:${pin}`))),
  )
  const v = modPow(g, x, N)
  const k = bytesToBigInt(
    await sha256(bigIntToBytes(N), bigIntToBytes(g, length)),
  )
  const b = bytesToBigInt(randomBytes(32))
  const B = (k * v + modPow(g, b, N)) % N
  const u = bytesToBigInt(
    await sha256(bigIntToBytes(A, length), bigIntToBytes(B, length)),
  )
  const S = modPow(A * modPow(v, u, N), b, N)
  const K = await sha256(bigIntToBytes(S))
  const hN = await sha256(bigIntToBytes(N))
  const hg = await sha256(bigIntToBytes(g, length))
  const expectedM = await sha256(
    hN.map((byte, index) => byte ^ (hg[index] as number)),
    await sha256(utf8(username)),
    salt,
    bigIntToBytes(A),
    bigIntToBytes(B),
    K,
  )
  return { salt, B, K, expectedM }
}

describe("SrpClient", () => {
  it("derives the helper's session key and proofs from the right code", async () => {
    const client = new SrpClient(new BinaryCodec(false))
    const server = await serverHandshake(
      client.username,
      "123456",
      client.publicKey,
    )

    const result = await client.computeProof(server.salt, server.B, "123456")

    expect(result.sessionKey.toHex()).toBe(server.K.toHex())
    expect(result.proof.toHex()).toBe(server.expectedM.toHex())
    const hamk = await sha256(
      bigIntToBytes(client.publicKey),
      server.expectedM,
      server.K,
    )
    expect(verifyServerProof(result, hamk)).toBe(true)
  })

  it("produces a proof the helper rejects when the code is wrong", async () => {
    const client = new SrpClient(new BinaryCodec(true))
    const server = await serverHandshake(
      client.username,
      "123456",
      client.publicKey,
    )

    const result = await client.computeProof(server.salt, server.B, "654321")

    expect(result.proof.toHex()).not.toBe(server.expectedM.toHex())
    expect(result.sessionKey.toHex()).not.toBe(server.K.toHex())
  })

  it("encodes the identity as 0x-prefixed hex or base64", () => {
    expect(new SrpClient(new BinaryCodec(false)).username).toMatch(
      /^0x[0-9a-f]+$/,
    )
    expect(new SrpClient(new BinaryCodec(true)).username).toMatch(
      /^[A-Za-z0-9+/]+=*$/,
    )
  })
})

describe("SecureSession", () => {
  async function helperKey(sessionKey: Uint8Array) {
    return crypto.subtle.importKey(
      "raw",
      sessionKey.slice(0, 16),
      "AES-GCM",
      false,
      ["encrypt", "decrypt"],
    )
  }

  it("sends ciphertext, tag, IV and reads IV, ciphertext, tag", async () => {
    const codec = new BinaryCodec(false)
    const sessionKey = randomBytes(32)
    const session = await SecureSession.create("0x0abc", codec, sessionKey)
    const key = await helperKey(sessionKey)

    const outgoing = JSON.parse(
      await session.seal({ ACT: 5, URL: "example.com" }),
    )
    expect(outgoing.TID).toBe("0x0abc")
    const sent = codec.decode(outgoing.SDATA)
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: sent.slice(-16) },
      key,
      sent.slice(0, -16),
    )
    expect(JSON.parse(fromUtf8(new Uint8Array(plain)))).toEqual({
      ACT: 5,
      URL: "example.com",
    })

    const iv = randomBytes(16)
    const reply = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        utf8('{"STATUS":3}'),
      ),
    )
    // The helper may pad the session ID differently and may send SMSG as an object.
    const opened = await session.open({
      TID: "0x00abc",
      SDATA: codec.encode(concat(iv, reply), false),
    })
    expect(opened).toEqual({ STATUS: 3 })
  })

  it("rejects replies addressed to another session", async () => {
    const codec = new BinaryCodec(true)
    const session = await SecureSession.create(
      codec.encode(Uint8Array.of(1)),
      codec,
      randomBytes(32),
    )
    await expect(
      session.open(
        JSON.stringify({ TID: codec.encode(Uint8Array.of(2)), SDATA: "AAAA" }),
      ),
    ).rejects.toThrow("another session")
  })
})

import { describe, expect, it } from "vitest"
import type { BitwardenApi } from "./api"
import { completeSecondStep, type PendingLogin } from "./auth"
import { KdfType } from "./crypto"

const pending: PendingLogin = {
  email: "someone@example.com",
  passwordHash: "hash",
  masterKey: new Uint8Array(32).toBase64(),
  kdf: { type: KdfType.Pbkdf2Sha256, iterations: 5000 },
  salt: "",
  methods: ["authenticator"],
}
const device = { identifier: "device", name: "chrome" }

describe("completeSecondStep", () => {
  it("reports a code the server did not accept with the sign-in error code", async () => {
    const api = {
      passwordToken: async () => ({ kind: "twoFactor", providers: [0] }),
    } as unknown as BitwardenApi
    await expect(
      completeSecondStep(api, device, pending, "authenticator", "000000"),
    ).rejects.toMatchObject({ code: "bitwarden.auth" })
  })
})

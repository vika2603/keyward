import { createRequire } from "node:module"
import type { PureCrypto } from "@bitwarden/sdk-internal"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { StoredPasskey } from "@/lib/passkeys/types"
import {
  COSE_ALG_ES256,
  createPasskeyCredential,
  fromBase64Url,
  p1363FromDerSignature,
  toBase64Url,
} from "@/lib/passkeys/webauthn"
import {
  type ExtensionHarness,
  launchExtension,
  startTestSite,
  type TestSiteServer,
} from "./harness"

const sdk = createRequire(import.meta.url)(
  "@bitwarden/sdk-internal/node/bitwarden_wasm_internal.js",
).PureCrypto as typeof PureCrypto

const SERVER = "https://vault.example.test"
const USER_ID = "user-e2e"
const ACCOUNT_ID = `${SERVER}|${USER_ID}`

/** Must exceed overlay-frame's SETTLE_MS (500ms) + IntersectionObserver delay (100ms). */
const OVERLAY_SETTLE_WAIT_MS = 850

describe("Keyward MV3 headless Chrome E2E", () => {
  let extension: ExtensionHarness
  let site: TestSiteServer
  const userKey = sdk.make_user_key_aes256_cbc_hmac()
  const encrypt = (text: string) =>
    text ? sdk.symmetric_encrypt_string(text, userKey) : null

  const encryptPasskey = (passkey: StoredPasskey) => ({
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

  beforeAll(async () => {
    site = await startTestSite()
    extension = await launchExtension()
  })

  afterAll(async () => {
    await extension?.close()
    await site?.close()
  })

  async function seedFullVault(origin: string) {
    const { stored: passkeyRecord, credential: createdPasskey } =
      await createPasskeyCredential({
        rpId: "localhost",
        rpName: "Localhost E2E",
        challenge: toBase64Url(new Uint8Array([1, 2, 3, 4])),
        userId: toBase64Url(new TextEncoder().encode("e2e-user-handle")),
        userName: "passkey-alice@localhost",
        userDisplayName: "Passkey Alice",
        pubKeyCredParams: [COSE_ALG_ES256],
        excludeCredentials: [],
        origin,
        crossOrigin: false,
      })

    const extraLogins = Array.from({ length: 4 }, (_, index) => ({
      Id: `login-extra-${index + 1}`,
      Type: 1,
      Edit: true,
      Reprompt: 0,
      FolderId: "folder-child",
      Name: encrypt(`Extra Account ${index + 1}`),
      Login: {
        Username: encrypt(`extra${index + 1}@example.test`),
        Password: encrypt("k9#Tv!82qM$pL4@wX7zN"),
        Uris: [{ Uri: encrypt(origin), Match: null }],
      },
    }))

    const syncData = {
      Profile: { Organizations: [] },
      Folders: [
        { Id: "folder-root", Name: encrypt("Work") },
        { Id: "folder-child", Name: encrypt("Work/Infra") },
      ],
      Collections: [],
      Ciphers: [
        {
          Id: "login-target",
          Type: 1,
          Edit: true,
          Reprompt: 0,
          FolderId: "folder-root",
          Name: encrypt("Primary Target"),
          Fields: [
            {
              Type: 0,
              Name: encrypt("company-code"),
              Value: encrypt("ACME-42"),
              LinkedId: null,
            },
          ],
          Login: {
            Username: encrypt("target-alice@example.test"),
            Password: encrypt("Targ3t!Strong#Pass99"),
            Uris: [{ Uri: encrypt(origin), Match: null }],
            Fido2Credentials: [encryptPasskey(passkeyRecord)],
          },
        },
        ...extraLogins,
        {
          Id: "login-weak-http",
          Type: 1,
          Edit: true,
          Reprompt: 0,
          Name: encrypt("Legacy Router"),
          Login: {
            Username: encrypt("admin"),
            Password: encrypt("password123"),
            Uris: [
              { Uri: encrypt("http://router.example.com/login"), Match: null },
            ],
          },
        },
        {
          Id: "login-archived",
          Type: 1,
          Edit: true,
          Reprompt: 0,
          ArchivedDate: "2026-10-01T00:00:00.000Z",
          Name: encrypt("Archived Legacy"),
          Login: {
            Username: encrypt("old@example.test"),
            Password: encrypt("OldP@ssword!99"),
            Uris: [{ Uri: encrypt("https://old.example.com"), Match: null }],
          },
        },
      ],
    }

    await extension.seedBitwarden({
      account: {
        id: ACCOUNT_ID,
        userId: USER_ID,
        email: "alice@example.test",
        name: "E2E Vault",
        server: SERVER,
        kdf: { type: 0, iterations: 5000 },
        salt: "",
        wrappedUserKey: "unused",
        encryptedRefreshToken: "unused",
      },
      userKeyBase64: userKey.toBase64(),
      syncData,
    })

    return { createdPasskey, passkeyRecord }
  }

  it("loads popup, options, and welcome pages cleanly without uncaught errors", async () => {
    await seedFullVault(site.origin)
    for (const pageName of ["popup.html", "options.html", "welcome.html"]) {
      const page = await extension.context.newPage()
      const errors: string[] = []
      page.on("pageerror", (error) => errors.push(error.message))
      await page.goto(`chrome-extension://${extension.extensionId}/${pageName}`)
      await page.waitForLoadState("networkidle")
      expect(errors).toEqual([])
      await page.close()
    }
  })

  it("opens inline menu, filters >=5 logins, and fills username, password, and custom field", async () => {
    await seedFullVault(site.origin)
    const page = await extension.context.newPage()
    await page.goto(`${site.origin}/login`, { waitUntil: "networkidle" })

    // Focus triggers Keyward's inline menu (menuTrigger: "focus").
    await page.locator("#username").click()
    const menuFrame = page.frameLocator(
      `iframe[src*="chrome-extension://${extension.extensionId}/inline-menu.html"]`,
    )

    // With 5 matching logins for localhost, the quick filter input is displayed.
    const filterInput = menuFrame.getByPlaceholder("Filter logins…")
    await filterInput.waitFor({ state: "visible", timeout: 10_000 })
    await filterInput.fill("target-alice")

    const targetRow = menuFrame
      .getByRole("menuitem")
      .filter({ hasText: "target-alice@example.test" })
    await targetRow.waitFor({ state: "visible", timeout: 5000 })
    await page.waitForTimeout(OVERLAY_SETTLE_WAIT_MS)
    await targetRow.click()

    await expect
      .poll(() => page.locator("#username").inputValue(), { timeout: 5000 })
      .toBe("target-alice@example.test")
    expect(await page.locator("#password").inputValue()).toBe(
      "Targ3t!Strong#Pass99",
    )
    expect(await page.locator("#company-code").inputValue()).toBe("ACME-42")
    await page.close()
  })

  it("suppresses save prompt on 401 failure, fills generated password on signup, and shows editable save prompt on 200", async () => {
    await seedFullVault(site.origin)
    const page = await extension.context.newPage()
    await page.goto(`${site.origin}/login`, { waitUntil: "networkidle" })

    // Submit credentials to the 401 endpoint -> SubmissionGate must drop the save prompt.
    await page.locator("#fail-user").fill("wrong@example.test")
    await page.locator("#fail-pass").fill("WrongPassword123!")
    await page.locator("#submit-fail").click()
    await page.waitForTimeout(700)
    const failPromptCount = await page
      .locator(
        `iframe[src*="chrome-extension://${extension.extensionId}/save-prompt.html"]`,
      )
      .count()
    expect(failPromptCount).toBe(0)

    // Navigate to signup form: suggest strong password, fill both new-password inputs, submit 200.
    await page.goto(`${site.origin}/signup`, { waitUntil: "networkidle" })
    await page.locator("#signup-user").fill("brandnew@example.test")
    await page.locator("#new-pass").click()

    const menuFrame = page.frameLocator(
      `iframe[src*="chrome-extension://${extension.extensionId}/inline-menu.html"]`,
    )
    const suggestRow = menuFrame
      .getByRole("menuitem")
      .filter({ hasText: "Use a strong password" })
    await suggestRow.waitFor({ state: "visible", timeout: 10_000 })
    await page.waitForTimeout(OVERLAY_SETTLE_WAIT_MS)
    await suggestRow.click()

    await expect
      .poll(async () => (await page.locator("#new-pass").inputValue()).length, {
        timeout: 5000,
      })
      .toBeGreaterThanOrEqual(12)
    const generated = await page.locator("#new-pass").inputValue()
    expect(await page.locator("#confirm-pass").inputValue()).toBe(generated)

    // Submit signup (200 OK) -> editable save prompt appears with username & password prefilled.
    await page.locator("#submit-signup").click()
    const promptFrame = page.frameLocator(
      `iframe[src*="chrome-extension://${extension.extensionId}/save-prompt.html"]`,
    )
    await promptFrame
      .getByText("Save this login?")
      .waitFor({ state: "visible", timeout: 10_000 })
    expect(await promptFrame.getByLabel("Username").inputValue()).toBe(
      "brandnew@example.test",
    )
    await page.close()
  })

  it("renders popup Security Checkup, Generator strength meter, and Forwarded alias options", async () => {
    await seedFullVault(site.origin)
    const page = await extension.context.newPage()
    await page.goto(`chrome-extension://${extension.extensionId}/popup.html`)
    await page.waitForLoadState("networkidle")

    // Open Security Checkup view from the header shield button.
    await page.getByRole("button", { name: "Security checkup" }).click()
    await page.getByText("Legacy Router").first().waitFor({
      state: "visible",
      timeout: 10_000,
    })
    await expect
      .poll(() => page.getByText("Used 4 times").count())
      .toBeGreaterThan(0)

    // Go back and open Generator view -> verify strength meter and Forwarded email alias UI.
    await page.getByRole("button", { name: "Back" }).click()
    await page.getByRole("button", { name: "Generator" }).click()
    await page
      .getByTestId("password-strength-meter")
      .waitFor({ state: "visible", timeout: 5000 })
    await page.getByRole("tab", { name: "Username" }).click()
    await page.getByRole("combobox", { name: "Type" }).click()
    await page.getByRole("option", { name: "Forwarded email alias" }).click()
    await page
      .getByLabel("API key")
      .waitFor({ state: "visible", timeout: 5000 })
    await page.close()
  })

  it("signs conditional WebAuthn assertion via Bitwarden passkey and shows native system fallback", async () => {
    const { createdPasskey } = await seedFullVault(site.origin)
    const page = await extension.context.newPage()
    await page.goto(`${site.origin}/passkey`, { waitUntil: "networkidle" })

    // Focus username field so Keyward's inline menu lists both Bitwarden passkey and system fallback.
    await page.locator("#pk-user").click()
    const menuFrame = page.frameLocator(
      `iframe[src*="chrome-extension://${extension.extensionId}/inline-menu.html"]`,
    )
    const bitwardenPasskeyRow = menuFrame
      .getByRole("menuitem")
      .filter({ hasText: "passkey-alice@localhost" })
    await bitwardenPasskeyRow.waitFor({ state: "visible", timeout: 10_000 })
    await menuFrame
      .getByRole("menuitem")
      .filter({ hasText: "System / Passwords passkey" })
      .waitFor({ state: "visible", timeout: 5000 })

    await page.waitForTimeout(OVERLAY_SETTLE_WAIT_MS)
    await bitwardenPasskeyRow.click()

    // Page's conditional navigator.credentials.get() resolves with a cryptographically valid assertion.
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (window as unknown as { __passkeyResult?: unknown })
                .__passkeyResult,
          ),
        { timeout: 5000 },
      )
      .not.toBeNull()

    const result = (await page.evaluate(
      () =>
        (window as unknown as { __passkeyResult: Record<string, unknown> })
          .__passkeyResult,
    )) as {
      id: string
      type: string
      response: {
        clientDataJSON: string
        authenticatorData: string
        signature: string
      }
    }
    expect(result.type).toBe("public-key")
    expect(result.id).toBe(createdPasskey.id)

    // Verify the DER ECDSA P-256 signature against the SPKI public key generated at registration.
    const publicKey = await crypto.subtle.importKey(
      "spki",
      fromBase64Url(createdPasskey.response.publicKey),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    )
    const authData = fromBase64Url(result.response.authenticatorData)
    const clientData = fromBase64Url(result.response.clientDataJSON)
    const clientDataHash = new Uint8Array(
      await crypto.subtle.digest("SHA-256", clientData),
    )
    const signedData = new Uint8Array(authData.length + clientDataHash.length)
    signedData.set(authData, 0)
    signedData.set(clientDataHash, authData.length)
    const verified = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      p1363FromDerSignature(fromBase64Url(result.response.signature)),
      signedData,
    )
    expect(verified).toBe(true)
    await page.close()
  })

  it("passes modal WebAuthn straight through to native browser when no Bitwarden account is configured", async () => {
    await extension.clearBitwarden()
    const page = await extension.context.newPage()
    // Observe whether the page bridge ever emits a modal bridge request to Keyward.
    await page.addInitScript(() => {
      ;(window as unknown as { __bridgeRequests: number }).__bridgeRequests = 0
      document.addEventListener("keyward:passkey-bridge-request", () => {
        ;(window as unknown as { __bridgeRequests: number }).__bridgeRequests++
      })
    })
    await page.goto(`${site.origin}/passkey`, { waitUntil: "networkidle" })
    // Give content script time to deliver `bitwardenPasskeys: false`.
    await page.waitForTimeout(400)

    const result = await page.evaluate(async () => {
      const controller = new AbortController()
      setTimeout(() => controller.abort(), 300)
      try {
        await navigator.credentials.create({
          signal: controller.signal,
          publicKey: {
            rp: { id: "localhost", name: "Localhost" },
            user: {
              id: new Uint8Array([1, 2, 3, 4]),
              name: "native@localhost",
              displayName: "Native",
            },
            challenge: new Uint8Array([9, 8, 7, 6]),
            pubKeyCredParams: [{ type: "public-key", alg: -7 }],
          },
        })
        return { error: null }
      } catch (error) {
        return {
          error: error instanceof Error ? error.name : String(error),
        }
      }
    })

    // Native browser handled the aborted request directly — zero bridge requests sent to Keyward.
    const bridgeRequests = await page.evaluate(
      () =>
        (window as unknown as { __bridgeRequests: number }).__bridgeRequests,
    )
    expect(bridgeRequests).toBe(0)
    expect(result.error).toBeTruthy()
    await page.close()
  })
})

import { afterAll, beforeAll, describe, expect, it } from "vitest"
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
  OVERLAY_SETTLE_WAIT_MS,
} from "./harness"
import { type MockBitwardenServer, startMockBitwarden } from "./mock-bitwarden"
import { startTestSite, type TestSiteServer } from "./test-site"

async function verifyDerAssertion(
  spkiBase64Url: string,
  response: {
    clientDataJSON: string
    authenticatorData: string
    signature: string
  },
): Promise<boolean> {
  const publicKey = await crypto.subtle.importKey(
    "spki",
    fromBase64Url(spkiBase64Url),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  )
  const authData = fromBase64Url(response.authenticatorData)
  const clientData = fromBase64Url(response.clientDataJSON)
  const clientDataHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", clientData),
  )
  const signedData = new Uint8Array(authData.length + clientDataHash.length)
  signedData.set(authData, 0)
  signedData.set(clientDataHash, authData.length)
  return crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    p1363FromDerSignature(fromBase64Url(response.signature)),
    signedData,
  )
}

describe("E2E 06 — Full WebAuthn Passkeys (Conditional, Modal Create/Get, Native Passthrough) & HTTP Basic Auth", () => {
  let extension: ExtensionHarness
  let bitwarden: MockBitwardenServer
  let site: TestSiteServer

  beforeAll(async () => {
    bitwarden = await startMockBitwarden()
    site = await startTestSite()
    extension = await launchExtension()
  })

  afterAll(async () => {
    await extension?.close()
    await bitwarden?.close()
    await site?.close()
  })

  it("signs conditional WebAuthn passkey via inline menu and shows native system fallback", async () => {
    const { stored, credential: created } = await createPasskeyCredential({
      rpId: "localhost",
      rpName: "Localhost E2E",
      challenge: toBase64Url(new Uint8Array([1, 2, 3, 4])),
      userId: toBase64Url(new TextEncoder().encode("cond-user-handle")),
      userName: "cond-alice@localhost",
      userDisplayName: "Conditional Alice",
      pubKeyCredParams: [COSE_ALG_ES256],
      excludeCredentials: [],
      origin: site.origin,
      crossOrigin: false,
    })
    bitwarden.reset({
      ciphers: [
        {
          Id: "cond-passkey-login",
          Type: 1,
          Edit: true,
          Reprompt: 0,
          Name: bitwarden.encrypt("Localhost Passkey"),
          Login: {
            Username: bitwarden.encrypt("cond-alice@localhost"),
            Password: bitwarden.encrypt("CondPass!2026"),
            Uris: [{ Uri: bitwarden.encrypt(site.origin), Match: null }],
            Fido2Credentials: [bitwarden.encryptPasskey(stored)],
          },
        },
      ],
    })
    await extension.seedBitwarden({ server: bitwarden })

    const page = await extension.context.newPage()
    await page.goto(`${site.origin}/passkey`, { waitUntil: "networkidle" })
    await page.locator("#pk-user").click()

    const menuFrame = page.frameLocator(`iframe[src*="inline-menu.html"]`)
    const bwRow = menuFrame
      .getByRole("menuitem")
      .filter({ hasText: "Passkey ·" })
    await bwRow.waitFor({ state: "visible", timeout: 10_000 })
    await menuFrame
      .getByRole("menuitem")
      .filter({ hasText: "System / Passwords passkey" })
      .waitFor({ state: "visible", timeout: 5000 })

    await page.waitForTimeout(OVERLAY_SETTLE_WAIT_MS)
    await bwRow.click()

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
    expect(result.id).toBe(created.id)
    expect(
      await verifyDerAssertion(created.response.publicKey, result.response),
    ).toBe(true)
    await page.close()
  })

  it("creates a modal WebAuthn passkey into Bitwarden and signs a modal assertion with it", async () => {
    bitwarden.reset({ ciphers: [] })
    await extension.seedBitwarden({ server: bitwarden })

    const page = await extension.context.newPage()
    await page.goto(`${site.origin}/passkey?noConditional=1`, {
      waitUntil: "networkidle",
    })
    await page.waitForTimeout(400)

    // 1. Trigger modal navigator.credentials.create() -> open popup on pending PasskeyView.
    const createPromise = page.evaluate(async () => {
      const cred = (await navigator.credentials.create({
        publicKey: {
          rp: { id: "localhost", name: "Localhost Modal" },
          user: {
            id: new Uint8Array([42, 43, 44, 45]),
            name: "modal-alice@localhost",
            displayName: "Modal Alice",
          },
          challenge: new Uint8Array([1, 3, 5, 7, 9, 11]),
          pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        },
      })) as PublicKeyCredential | null
      return cred ? cred.toJSON() : null
    })

    // In headless Chrome, action.openPopup() succeeds silently without showing UI; opening
    // popup.html claims the pending PasskeyView via popup.takeView just like a toolbar popup.
    await page.waitForTimeout(300)
    const createPopup = await extension.openExtensionPage("popup.html")
    await createPopup
      .getByText("Save passkey for localhost")
      .waitFor({ state: "visible", timeout: 10_000 })
    await createPopup.getByRole("button", { name: /Save as new login/ }).click()

    const createdJson = (await createPromise) as {
      id: string
      response: { publicKey: string }
    } | null
    expect(createdJson?.id).toBeTruthy()
    expect(bitwarden.state.ciphers.length).toBe(1)
    await createPopup.close().catch(() => {})

    // 2. Trigger modal navigator.credentials.get() -> pick the newly saved passkey & verify signature!
    const getPromise = page.evaluate(async () => {
      const cred = (await navigator.credentials.get({
        publicKey: {
          rpId: "localhost",
          challenge: new Uint8Array([2, 4, 6, 8, 10, 12]),
          userVerification: "preferred",
        },
      })) as PublicKeyCredential | null
      return cred ? cred.toJSON() : null
    })

    await page.waitForTimeout(300)
    const getPopup = await extension.openExtensionPage("popup.html")
    await getPopup
      .getByText("Sign in to localhost")
      .waitFor({ state: "visible", timeout: 10_000 })
    await getPopup
      .getByRole("button", { name: /modal-alice@localhost/ })
      .click()

    const assertedJson = (await getPromise) as {
      id: string
      response: {
        clientDataJSON: string
        authenticatorData: string
        signature: string
      }
    } | null
    expect(assertedJson?.id).toBe(createdJson?.id)
    expect(
      await verifyDerAssertion(
        createdJson?.response.publicKey ?? "",
        assertedJson?.response ?? {
          clientDataJSON: "",
          authenticatorData: "",
          signature: "",
        },
      ),
    ).toBe(true)
    await getPopup.close().catch(() => {})
    await page.close()
  })

  it("passes modal WebAuthn straight through to native browser when no Bitwarden account is configured", async () => {
    await extension.clearStorage()
    const page = await extension.context.newPage()
    await page.addInitScript(() => {
      ;(window as unknown as { __bridgeRequests: number }).__bridgeRequests = 0
      document.addEventListener("keyward:passkey-bridge-request", () => {
        ;(window as unknown as { __bridgeRequests: number }).__bridgeRequests++
      })
    })
    await page.goto(`${site.origin}/passkey?noConditional=1`, {
      waitUntil: "networkidle",
    })
    await page.waitForTimeout(400)

    const errorName = await page.evaluate(async () => {
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
        return null
      } catch (error) {
        return error instanceof Error ? error.name : String(error)
      }
    })

    const bridgeRequests = await page.evaluate(
      () =>
        (window as unknown as { __bridgeRequests: number }).__bridgeRequests,
    )
    expect(bridgeRequests).toBe(0)
    expect(errorName).toBeTruthy()
    await page.close()
  })

  it("answers HTTP Basic Auth challenges via Keyward popup chooser", async () => {
    bitwarden.reset({
      ciphers: [
        {
          Id: "basic-auth-login",
          Type: 1,
          Edit: true,
          Reprompt: 0,
          Name: bitwarden.encrypt("Router Admin"),
          Login: {
            Username: bitwarden.encrypt("router-admin"),
            Password: bitwarden.encrypt("Router!Secret#42"),
            Uris: [{ Uri: bitwarden.encrypt(site.origin), Match: null }],
          },
        },
      ],
    })
    await extension.seedBitwarden({ server: bitwarden })

    const page = await extension.context.newPage()
    const navPromise = page.goto(`${site.origin}/basic-auth`, {
      waitUntil: "domcontentloaded",
    })

    await page.waitForTimeout(300)
    const authPopup = await extension.openExtensionPage("popup.html")
    await authPopup
      .getByText(/Sign in to localhost/)
      .waitFor({ state: "visible", timeout: 10_000 })
    await authPopup.getByRole("button", { name: /router-admin/ }).click()

    await navPromise
    await expect
      .poll(() => page.locator("#auth-ok").textContent(), { timeout: 5000 })
      .toBe("router-admin:Router!Secret#42")
    await authPopup.close().catch(() => {})
    await page.close()
  })
})

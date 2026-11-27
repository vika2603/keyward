import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  type ExtensionHarness,
  launchExtension,
  OVERLAY_SETTLE_WAIT_MS,
} from "./harness"
import { type MockBitwardenServer, startMockBitwarden } from "./mock-bitwarden"
import { startTestSite, type TestSiteServer } from "./test-site"

/** Standard RFC 6238 base32 TOTP test secret. */
const TEST_TOTP_SECRET = "JBSWY3DPEHPK3PXP"

describe("E2E 02 — Autofill, Quick Filter, Shadow DOM, Custom Fields & TOTP", () => {
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

  async function seedAutofillVault() {
    const extraLogins = Array.from({ length: 4 }, (_, index) => ({
      Id: `extra-${index + 1}`,
      Type: 1,
      Edit: true,
      Reprompt: 0,
      Name: bitwarden.encrypt(`Extra Account ${index + 1}`),
      Login: {
        Username: bitwarden.encrypt(`extra${index + 1}@example.test`),
        Password: bitwarden.encrypt("ExtraPass!2026"),
        Uris: [{ Uri: bitwarden.encrypt(site.origin), Match: null }],
      },
    }))

    bitwarden.reset({
      ciphers: [
        {
          Id: "target-login",
          Type: 1,
          Edit: true,
          Reprompt: 0,
          Name: bitwarden.encrypt("Primary Target"),
          Fields: [
            {
              Type: 0,
              Name: bitwarden.encrypt("company-code"),
              Value: bitwarden.encrypt("ACME-42"),
              LinkedId: null,
            },
          ],
          Login: {
            Username: bitwarden.encrypt("target-alice@example.test"),
            Password: bitwarden.encrypt("Targ3t!Strong#Pass99"),
            Totp: bitwarden.encrypt(TEST_TOTP_SECRET),
            Uris: [{ Uri: bitwarden.encrypt(site.origin), Match: null }],
          },
        },
        ...extraLogins,
      ],
    })
    await extension.seedBitwarden({ server: bitwarden })
  }

  it("opens inline menu, filters >=5 logins, and fills username, password, and custom field", async () => {
    await seedAutofillVault()
    const page = await extension.context.newPage()
    await page.goto(`${site.origin}/login`, { waitUntil: "networkidle" })

    await page.locator("#username").click()
    const menuFrame = page.frameLocator(
      `iframe[src*="chrome-extension://${extension.extensionId}/inline-menu.html"]`,
    )

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

  it("detects and fills login inputs nested inside an open Shadow DOM custom element", async () => {
    await seedAutofillVault()
    const page = await extension.context.newPage()
    await page.goto(`${site.origin}/shadow`, { waitUntil: "networkidle" })

    // Playwright pierces open shadow DOM automatically with locator("#shadow-user").
    await page.locator("#shadow-user").click()
    const menuFrame = page.frameLocator(
      `iframe[src*="chrome-extension://${extension.extensionId}/inline-menu.html"]`,
    )
    const filterInput = menuFrame.getByPlaceholder("Filter logins…")
    await filterInput.waitFor({ state: "visible", timeout: 10_000 })
    await filterInput.fill("target-alice")

    const row = menuFrame
      .getByRole("menuitem")
      .filter({ hasText: "target-alice@example.test" })
    await row.waitFor({ state: "visible", timeout: 5000 })
    await page.waitForTimeout(OVERLAY_SETTLE_WAIT_MS)
    await row.click()

    await expect
      .poll(() => page.locator("#shadow-user").inputValue(), { timeout: 5000 })
      .toBe("target-alice@example.test")
    expect(await page.locator("#shadow-pass").inputValue()).toBe(
      "Targ3t!Strong#Pass99",
    )
    await page.close()
  })

  it("fills a live 6-digit TOTP verification code into one-time-code fields", async () => {
    await seedAutofillVault()
    const page = await extension.context.newPage()
    await page.goto(`${site.origin}/otp`, { waitUntil: "networkidle" })

    await page.locator("#otp-code").click()
    const menuFrame = page.frameLocator(
      `iframe[src*="chrome-extension://${extension.extensionId}/inline-menu.html"]`,
    )
    const codeRow = menuFrame
      .getByRole("menuitem")
      .filter({ hasText: "target-alice@example.test" })
    await codeRow.waitFor({ state: "visible", timeout: 10_000 })
    await page.waitForTimeout(OVERLAY_SETTLE_WAIT_MS)
    await codeRow.click()

    await expect
      .poll(() => page.locator("#otp-code").inputValue(), { timeout: 5000 })
      .toMatch(/^\d{6}$/)
    await page.close()
  })

  it("supports keyboard navigation (ArrowDown + Enter) and shows empty-state New login row", async () => {
    // 1. Single login -> keyboard ArrowDown + Enter fills without mouse click.
    bitwarden.reset({
      ciphers: [
        {
          Id: "kbd-login",
          Type: 1,
          Edit: true,
          Reprompt: 0,
          Name: bitwarden.encrypt("Keyboard Site"),
          Login: {
            Username: bitwarden.encrypt("kbd@example.test"),
            Password: bitwarden.encrypt("KbdPass!2026"),
            Uris: [{ Uri: bitwarden.encrypt(site.origin), Match: null }],
          },
        },
      ],
    })
    await extension.seedBitwarden({ server: bitwarden })
    const page = await extension.context.newPage()
    await page.goto(`${site.origin}/login`, { waitUntil: "networkidle" })

    await page.locator("#username").click()
    const menuFrame = page.frameLocator(
      `iframe[src*="chrome-extension://${extension.extensionId}/inline-menu.html"]`,
    )
    await menuFrame
      .getByRole("menuitem")
      .filter({ hasText: "kbd@example.test" })
      .waitFor({ state: "visible", timeout: 10_000 })
    await page.waitForTimeout(OVERLAY_SETTLE_WAIT_MS)
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("Enter")

    await expect
      .poll(() => page.locator("#username").inputValue(), { timeout: 5000 })
      .toBe("kbd@example.test")
    await page.close()

    // 2. Empty vault -> menu offers "No passwords for localhost" + "New login".
    bitwarden.reset({ ciphers: [] })
    await extension.seedBitwarden({ server: bitwarden })
    const emptyPage = await extension.context.newPage()
    await emptyPage.goto(`${site.origin}/login`, { waitUntil: "networkidle" })
    await emptyPage.locator("#username").click()
    const emptyMenu = emptyPage.frameLocator(
      `iframe[src*="chrome-extension://${extension.extensionId}/inline-menu.html"]`,
    )
    await emptyMenu
      .getByText("No passwords for localhost")
      .waitFor({ state: "visible", timeout: 10_000 })
    await emptyMenu
      .getByRole("menuitem", { name: "New login" })
      .waitFor({ state: "visible", timeout: 5000 })
    await emptyPage.close()
  })
})

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  type ExtensionHarness,
  launchExtension,
  OVERLAY_SETTLE_WAIT_MS,
} from "./harness"
import { type MockBitwardenServer, startMockBitwarden } from "./mock-bitwarden"
import { startTestSite, type TestSiteServer } from "./test-site"

describe("E2E 03 — Save Prompt, Update Prompt, Submission Gate & Locked Unlock-to-Save", () => {
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

  it("suppresses save prompt on 401 failure, fills generated password on signup, and saves edited credentials to Bitwarden", async () => {
    bitwarden.reset({ ciphers: [] })
    await extension.seedBitwarden({ server: bitwarden })

    const page = await extension.context.newPage()
    await page.goto(`${site.origin}/login`, { waitUntil: "networkidle" })

    // 401 failure must be discarded by SubmissionGate.
    await page.locator("#fail-user").fill("wrong@example.test")
    await page.locator("#fail-pass").fill("WrongPass123!")
    await page.locator("#submit-fail").click()
    await page.waitForTimeout(700)
    expect(await page.locator(`iframe[src*="save-prompt.html"]`).count()).toBe(
      0,
    )

    // Signup form: use generated strong password suggestion, submit 200, edit username & save!
    await page.goto(`${site.origin}/signup`, { waitUntil: "networkidle" })
    await page.locator("#signup-user").fill("initial@example.test")
    await page.locator("#new-pass").click()

    const menuFrame = page.frameLocator(`iframe[src*="inline-menu.html"]`)
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
    const generatedPassword = await page.locator("#new-pass").inputValue()
    expect(await page.locator("#confirm-pass").inputValue()).toBe(
      generatedPassword,
    )

    await page.locator("#submit-signup").click()
    const promptFrame = page.frameLocator(`iframe[src*="save-prompt.html"]`)
    await promptFrame
      .getByText("Save this login?")
      .waitFor({ state: "visible", timeout: 10_000 })

    // Edit the username inside the save prompt before clicking Save.
    const usernameInput = promptFrame.getByLabel("Username")
    await usernameInput.fill("edited-signup@example.test")
    await page.waitForTimeout(OVERLAY_SETTLE_WAIT_MS)
    await promptFrame.getByRole("button", { name: "Save" }).click()

    await expect
      .poll(() => bitwarden.state.ciphers.length, { timeout: 10_000 })
      .toBe(1)
    const savedLogin = bitwarden.state.ciphers[0]?.Login as Record<
      string,
      unknown
    >
    expect(bitwarden.decrypt(savedLogin.Username)).toBe(
      "edited-signup@example.test",
    )
    expect(bitwarden.decrypt(savedLogin.Password)).toBe(generatedPassword)
    await page.close()
  })

  it("detects change-password submission, updates existing Bitwarden login, and records password history", async () => {
    bitwarden.reset({
      ciphers: [
        {
          Id: "existing-login",
          Type: 1,
          Edit: true,
          Reprompt: 0,
          Name: bitwarden.encrypt("Localhost Account"),
          Login: {
            Username: bitwarden.encrypt("changer@example.test"),
            Password: bitwarden.encrypt("OldPass!2025"),
            Uris: [{ Uri: bitwarden.encrypt(site.origin), Match: null }],
          },
        },
      ],
    })
    await extension.seedBitwarden({ server: bitwarden })

    const page = await extension.context.newPage()
    await page.goto(`${site.origin}/change-password`, {
      waitUntil: "networkidle",
    })
    await page.locator("#cp-user").fill("changer@example.test")
    await page.locator("#cp-current").fill("OldPass!2025")
    await page.locator("#cp-new").fill("BrandNewPass!2026")
    await page.locator("#cp-confirm").fill("BrandNewPass!2026")
    await page.locator("#submit-change-pw").click()

    const promptFrame = page.frameLocator(`iframe[src*="save-prompt.html"]`)
    await promptFrame
      .getByText("Update the saved password?")
      .waitFor({ state: "visible", timeout: 10_000 })
    await page.waitForTimeout(OVERLAY_SETTLE_WAIT_MS)
    await promptFrame.getByRole("button", { name: "Update" }).click()

    await expect
      .poll(
        () =>
          bitwarden.decrypt(
            (bitwarden.state.ciphers[0]?.Login as Record<string, unknown>)
              ?.Password,
          ),
        { timeout: 10_000 },
      )
      .toBe("BrandNewPass!2026")

    const history = bitwarden.state.ciphers[0]?.PasswordHistory as
      | Record<string, unknown>[]
      | undefined
    expect(history?.length).toBe(1)
    expect(bitwarden.decrypt(history?.[0]?.Password)).toBe("OldPass!2025")
    await page.close()
  })

  it("defers saving when vault is locked, unlocks inline in save prompt, and auto-saves to Bitwarden", async () => {
    bitwarden.reset({ ciphers: [] })
    await extension.seedBitwarden({ server: bitwarden, unlocked: false })

    const page = await extension.context.newPage()
    await page.goto(`${site.origin}/login`, { waitUntil: "networkidle" })
    await page.locator("#username").fill("locked-user@example.test")
    await page.locator("#password").fill("LockedSave!2026")
    await page.locator("#submit-ok").click()

    const promptFrame = page.frameLocator(`iframe[src*="save-prompt.html"]`)
    await promptFrame
      .getByText("Unlock to save this login?")
      .waitFor({ state: "visible", timeout: 10_000 })

    await promptFrame
      .getByLabel("Master password")
      .fill(bitwarden.masterPassword)
    await page.waitForTimeout(OVERLAY_SETTLE_WAIT_MS)
    await promptFrame.getByRole("button", { name: "Unlock and save" }).click()

    await expect
      .poll(() => bitwarden.state.ciphers.length, { timeout: 10_000 })
      .toBe(1)
    const savedLogin = bitwarden.state.ciphers[0]?.Login as Record<
      string,
      unknown
    >
    expect(bitwarden.decrypt(savedLogin.Username)).toBe(
      "locked-user@example.test",
    )
    expect(bitwarden.decrypt(savedLogin.Password)).toBe("LockedSave!2026")
    await page.close()
  })

  it("honors 'Never for this site' and suppresses future save prompts", async () => {
    bitwarden.reset({ ciphers: [] })
    await extension.seedBitwarden({ server: bitwarden })

    const page = await extension.context.newPage()
    await page.goto(`${site.origin}/login`, { waitUntil: "networkidle" })
    await page.locator("#username").fill("never@example.test")
    await page.locator("#password").fill("NeverSave!2026")
    await page.locator("#submit-ok").click()

    const promptFrame = page.frameLocator(`iframe[src*="save-prompt.html"]`)
    await promptFrame
      .getByText("Save this login?")
      .waitFor({ state: "visible", timeout: 10_000 })
    await page.waitForTimeout(OVERLAY_SETTLE_WAIT_MS)
    await promptFrame
      .getByRole("button", { name: "Never for this site" })
      .click()

    await expect
      .poll(() => page.locator(`iframe[src*="save-prompt.html"]`).count(), {
        timeout: 5000,
      })
      .toBe(0)

    // Submitting again on the same site must not trigger a save prompt.
    await page.locator("#username").fill("never-again@example.test")
    await page.locator("#password").fill("NeverSaveAgain!2026")
    await page.locator("#submit-ok").click()
    await page.waitForTimeout(700)
    expect(await page.locator(`iframe[src*="save-prompt.html"]`).count()).toBe(
      0,
    )
    await page.close()
  })
})

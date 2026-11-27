import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type ExtensionHarness, launchExtension } from "./harness"
import { type MockBitwardenServer, startMockBitwarden } from "./mock-bitwarden"
import { startTestSite, type TestSiteServer } from "./test-site"

describe("E2E 01 — Auth, Lock/Unlock, Sync, Options & Site Rules", () => {
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

  it("boots welcome, options, and popup pages cleanly without uncaught errors", async () => {
    await extension.clearStorage()
    for (const pageName of ["welcome.html", "options.html", "popup.html"]) {
      const page = await extension.openExtensionPage(pageName)
      const errors: string[] = []
      page.on("pageerror", (error) => errors.push(error.message))
      await page.waitForTimeout(250)
      expect(errors).toEqual([])
      await page.close()
    }
  })

  it("signs in to a self-hosted Bitwarden server, syncs, locks, unlocks, renames, and signs out", async () => {
    await extension.clearStorage()
    bitwarden.reset({
      ciphers: [
        {
          Id: "signin-login-1",
          Type: 1,
          Edit: true,
          Reprompt: 0,
          Name: bitwarden.encrypt("Signed-In Site"),
          Login: {
            Username: bitwarden.encrypt("signedin@example.test"),
            Password: bitwarden.encrypt("S1gnedIn!Strong#9"),
            Uris: [{ Uri: bitwarden.encrypt(site.origin), Match: null }],
          },
        },
      ],
    })

    // 1. Real Bitwarden self-hosted sign-in via Options -> Vaults -> Sign in.
    const options = await extension.openExtensionPage("options.html")
    options.setDefaultTimeout(5000)
    await options.getByRole("button", { name: "Sign in" }).click()
    await options.getByRole("button", { name: /Server:/ }).click()
    await options.getByRole("menuitem", { name: "Self-hosted" }).click()
    await options.getByLabel("Server URL").fill(bitwarden.url)
    await options.getByRole("button", { name: "Save" }).click()

    await options.getByLabel("Email").fill(bitwarden.email)
    await options.getByLabel("Master password").fill(bitwarden.masterPassword)
    await options.getByRole("button", { name: "Sign in" }).last().click()

    // Wait for real PBKDF2 prelogin + token + initial sync to finish and show account row.
    await options
      .getByText(bitwarden.email)
      .first()
      .waitFor({ state: "visible", timeout: 15_000 })
    expect(bitwarden.state.syncCount).toBeGreaterThanOrEqual(1)

    // 2. Rename account in Options.
    await options.getByRole("button", { name: "Rename" }).click()
    await options.getByRole("textbox", { name: "Name" }).fill("Personal BW")
    await options.getByRole("button", { name: "Save" }).click()
    await options
      .getByText("Personal BW")
      .first()
      .waitFor({ state: "visible", timeout: 5000 })

    // 3. Open popup -> verify synced login, manual sync (/revision-date), lock, and unlock.
    const popup = await extension.openExtensionPage("popup.html")
    await popup
      .getByText("Signed-In Site")
      .waitFor({ state: "visible", timeout: 10_000 })

    const checksBefore = bitwarden.state.revisionDateChecks
    await popup.getByRole("button", { name: "Sync vaults" }).click()
    await expect
      .poll(() => bitwarden.state.revisionDateChecks, { timeout: 5000 })
      .toBeGreaterThan(checksBefore)

    // Lock all vaults -> popup shows Unlock Bitwarden card.
    await popup.getByRole("button", { name: "Lock all" }).click()
    await popup
      .getByText("Unlock Bitwarden")
      .waitFor({ state: "visible", timeout: 10_000 })

    // Unlock using master password -> synced login is visible again.
    await popup.getByText("Unlock Bitwarden").click()
    await popup.getByLabel("Master password").fill(bitwarden.masterPassword)
    await popup.getByRole("button", { name: "Unlock" }).click()
    await popup
      .getByText("Signed-In Site")
      .waitFor({ state: "visible", timeout: 10_000 })
    await popup.close()

    // 4. Sign out from Options -> account disappears.
    await options.reload({ waitUntil: "networkidle" })
    await options.getByRole("button", { name: "Sign out" }).click()
    await options
      .getByRole("alertdialog")
      .getByRole("button", { name: "Sign out" })
      .click()
    await options
      .getByText("Not signed in.")
      .waitFor({ state: "visible", timeout: 10_000 })
    await options.close()
  })

  it("switches UI language live and enforces per-site disabled rules", async () => {
    bitwarden.reset({
      ciphers: [
        {
          Id: "rule-login",
          Type: 1,
          Edit: true,
          Reprompt: 0,
          Name: bitwarden.encrypt("Localhost Login"),
          Login: {
            Username: bitwarden.encrypt("rule-user@example.test"),
            Password: bitwarden.encrypt("RulePass!99"),
            Uris: [{ Uri: bitwarden.encrypt(site.origin), Match: null }],
          },
        },
      ],
    })
    await extension.seedBitwarden({ server: bitwarden })

    const options = await extension.openExtensionPage("options.html")
    options.setDefaultTimeout(5000)

    // Add a site rule disabling Keyward on localhost.
    await options.getByRole("link", { name: "Site rules" }).click()
    await options.getByRole("button", { name: "Add rule" }).click()
    await options.getByLabel("Website").fill("localhost")
    await options.getByRole("combobox", { name: "Behavior" }).click()
    await options
      .getByRole("option", { name: "Don't fill or ask to save" })
      .click()
    await options.getByRole("button", { name: "Add", exact: true }).click()
    await options
      .getByText("localhost")
      .waitFor({ state: "visible", timeout: 5000 })

    // Visit /login -> Keyward must NOT open an inline menu when disabled by site rule.
    const webPage = await extension.context.newPage()
    await webPage.goto(`${site.origin}/login`, { waitUntil: "networkidle" })
    await webPage.locator("#username").click()
    await webPage.waitForTimeout(600)
    const disabledMenuCount = await webPage
      .locator(`iframe[src*="inline-menu.html"]`)
      .count()
    expect(disabledMenuCount).toBe(0)
    await webPage.close()

    // Delete the site rule.
    await options
      .getByRole("button", { name: "Delete rule for localhost" })
      .click()
    await options
      .getByText("No rules yet.")
      .waitFor({ state: "visible", timeout: 5000 })

    // Switch language to 简体中文 and verify headings translate immediately.
    await options
      .getByRole("link", { name: "Shortcuts and appearance" })
      .click()
    await options.getByRole("button", { name: "简体中文" }).click()
    await options
      .getByRole("heading", { name: "快捷键与外观" })
      .waitFor({ state: "visible", timeout: 5000 })

    // Restore English.
    await options.getByRole("button", { name: "English" }).click()
    await options
      .getByRole("heading", { name: "Shortcuts and appearance" })
      .waitFor({ state: "visible", timeout: 5000 })
    await options.close()
  })
})

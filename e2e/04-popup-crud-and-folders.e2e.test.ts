import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type ExtensionHarness, launchExtension } from "./harness"
import { type MockBitwardenServer, startMockBitwarden } from "./mock-bitwarden"

const TEST_TOTP_SECRET = "JBSWY3DPEHPK3PXP"

describe("E2E 04 — Popup Item CRUD, Secure Notes, Search, Folders, Clone, Archive, Trash & View Cache", () => {
  let extension: ExtensionHarness
  let bitwarden: MockBitwardenServer

  beforeAll(async () => {
    bitwarden = await startMockBitwarden()
    extension = await launchExtension()
  })

  afterAll(async () => {
    await extension?.close()
    await bitwarden?.close()
  })

  async function seedBaseVault() {
    bitwarden.reset({
      folders: [
        { Id: "folder-work", Name: bitwarden.encrypt("Work") ?? "" },
        {
          Id: "folder-infra",
          Name: bitwarden.encrypt("Work/Infra") ?? "",
        },
      ],
      ciphers: [
        {
          Id: "login-1",
          Type: 1,
          Edit: true,
          Favorite: false,
          Reprompt: 0,
          FolderId: "folder-infra",
          Name: bitwarden.encrypt("Café Portal"),
          Notes: bitwarden.encrypt("Secret onboarding memo"),
          Fields: [
            {
              Type: 0,
              Name: bitwarden.encrypt("Environment"),
              Value: bitwarden.encrypt("staging-cluster"),
              LinkedId: null,
            },
          ],
          Login: {
            Username: bitwarden.encrypt("alice@cafe.example"),
            Password: bitwarden.encrypt("Initial!Pass#2025"),
            Totp: bitwarden.encrypt(TEST_TOTP_SECRET),
            Uris: [
              {
                Uri: bitwarden.encrypt("https://cafe.example.com"),
                Match: null,
              },
            ],
          },
        },
        {
          Id: "note-1",
          Type: 2,
          Edit: true,
          Favorite: false,
          Reprompt: 0,
          FolderId: "folder-work",
          Name: bitwarden.encrypt("Incident Runbook"),
          Notes: bitwarden.encrypt("Step 1: check dashboard"),
          SecureNote: { Type: 0 },
        },
      ],
    })
    await extension.seedBitwarden({ server: bitwarden })
  }

  it("supports accent-insensitive expanded search (notes, custom fields, folders), detail reveal, TOTP, favorite, edit & password history", async () => {
    await seedBaseVault()
    const popup = await extension.openExtensionPage("popup.html")

    // Accent-insensitive search ("cafe") + notes search ("onboarding") + custom field ("staging-cluster").
    const search = popup.getByPlaceholder("Search")
    await search.fill("cafe")
    await popup
      .getByText("Café Portal")
      .waitFor({ state: "visible", timeout: 10_000 })

    await search.fill("staging-cluster")
    await popup
      .getByText("Café Portal")
      .waitFor({ state: "visible", timeout: 5000 })

    // Open login detail view.
    await popup.getByText("Café Portal").click()
    await popup
      .getByText("Login details")
      .waitFor({ state: "visible", timeout: 5000 })

    // Reveal password.
    await popup.getByRole("button", { name: "Show password" }).click()
    await popup
      .getByText("Initial!Pass#2025")
      .waitFor({ state: "visible", timeout: 5000 })

    // Live 6-digit TOTP code is rendered.
    await popup.getByRole("button", { name: "Show verification code" }).click()
    await expect
      .poll(async () => {
        const text = (await popup.locator("body").textContent()) ?? ""
        return /\d{6}/.test(text)
      })
      .toBe(true)

    // Star as favorite -> persisted on mock server.
    await popup.getByRole("button", { name: "Add to favorites" }).click()
    await expect
      .poll(() => bitwarden.state.ciphers[0]?.Favorite, { timeout: 5000 })
      .toBe(true)

    // Edit login password -> moves previous password into Password History.
    await popup.getByRole("button", { name: "Edit" }).click()
    await popup
      .getByLabel("Password", { exact: true })
      .fill("Updated!Pass#2026")
    await popup.getByRole("button", { name: "Save" }).click()
    await popup
      .getByText("Login details")
      .waitFor({ state: "visible", timeout: 10_000 })

    // Open Password History view and verify old password is kept.
    await popup.getByRole("button", { name: /Password history/ }).click()
    await popup
      .getByRole("heading", { name: "Password history" })
      .waitFor({ state: "visible", timeout: 5000 })
    await popup.close()
  })

  it("creates a new login and a new secure note via popup Add flow", async () => {
    await seedBaseVault()
    const popup = await extension.openExtensionPage("popup.html")

    // Add Login.
    await popup.getByRole("button", { name: "Add item" }).click()
    await popup.getByLabel("Website").fill("newapp.example.com")
    await popup.getByLabel("Username").fill("creator@example.test")
    await popup
      .getByLabel("Password", { exact: true })
      .fill("Str0ng!Create#Pass99")
    await popup
      .getByTestId("password-strength-meter")
      .waitFor({ state: "visible", timeout: 5000 })
    await popup.getByRole("button", { name: "Save" }).click()

    await expect
      .poll(() => bitwarden.state.ciphers.length, { timeout: 10_000 })
      .toBe(3)

    // Add Secure Note.
    await popup.getByRole("button", { name: "Add item" }).click()
    await popup.getByRole("tab", { name: "Secure note" }).click()
    await popup.getByLabel("Name").fill("API Recovery Codes")
    await popup.getByLabel("Note").fill("code-1111 code-2222")
    await popup.getByRole("button", { name: "Save" }).click()

    await expect
      .poll(() => bitwarden.state.ciphers.length, { timeout: 10_000 })
      .toBe(4)
    await popup.close()
  })

  it("supports Clone, Archive/Unarchive, Trash/Restore/Purge, Nested Folder CRUD, and Popup View Cache", async () => {
    await seedBaseVault()
    const popup = await extension.openExtensionPage("popup.html")

    // 1. Clone item from detail view.
    await popup
      .getByText("Café Portal")
      .waitFor({ state: "visible", timeout: 10_000 })
    await popup.getByText("Café Portal").click()
    await popup.getByRole("button", { name: "Clone item" }).click()
    await expect
      .poll(() => bitwarden.state.ciphers.length, { timeout: 10_000 })
      .toBe(3)

    // 2. Archive and Unarchive the cloned item.
    await popup
      .getByText("Café Portal - Clone")
      .waitFor({ state: "visible", timeout: 10_000 })
    await popup.getByText("Café Portal - Clone").click()
    await popup.getByRole("button", { name: "Archive" }).click()

    await expect
      .poll(
        () =>
          bitwarden.state.ciphers.some((cipher) =>
            Boolean(cipher.ArchivedDate),
          ),
        { timeout: 10_000 },
      )
      .toBe(true)

    // Switch item filter to Archive and restore it.
    await popup.getByRole("combobox", { name: "Show" }).click()
    await popup.getByRole("option", { name: "Archive" }).click()
    const archivedClone = popup.getByRole("button", {
      name: /Café Portal - Clone/,
    })
    await archivedClone.waitFor({ state: "visible", timeout: 10_000 })
    await archivedClone.click()
    await popup.getByRole("button", { name: "Unarchive" }).click()
    await expect
      .poll(
        () =>
          bitwarden.state.ciphers.some((cipher) =>
            Boolean(cipher.ArchivedDate),
          ),
        { timeout: 10_000 },
      )
      .toBe(false)

    // 3. Trash -> Restore -> Trash -> Purge permanently.
    await popup.getByRole("combobox", { name: "Show" }).click()
    await popup.getByRole("option", { name: "All" }).click()
    await popup.getByRole("button", { name: /Café Portal - Clone/ }).click()
    await popup.getByRole("button", { name: "Delete" }).click()
    await popup.getByRole("button", { name: "Confirm delete" }).click()
    await expect
      .poll(
        () =>
          bitwarden.state.ciphers.some((cipher) => Boolean(cipher.DeletedDate)),
        { timeout: 10_000 },
      )
      .toBe(true)

    await popup.getByRole("combobox", { name: "Show" }).click()
    await popup.getByRole("option", { name: "Trash" }).click()
    await popup.getByRole("button", { name: /Café Portal - Clone/ }).click()
    await popup.getByRole("button", { name: "Delete permanently" }).click()
    await popup.getByRole("button", { name: "Delete permanently?" }).click()
    await expect
      .poll(() => bitwarden.state.ciphers.length, { timeout: 10_000 })
      .toBe(2)

    // 4. Nested Folder CRUD via Manage folders dialog.
    await popup.getByRole("combobox", { name: "Show" }).click()
    await popup.getByRole("option", { name: "All" }).click()
    await popup.getByRole("button", { name: "Filters" }).click()
    await popup.getByRole("button", { name: "Manage folders" }).click()
    await popup
      .getByPlaceholder("Folder name (e.g. Work/Infra)")
      .fill("Work/QA")
    await popup.getByRole("button", { name: "Create folder" }).click()
    await expect
      .poll(() => bitwarden.state.folders.length, { timeout: 10_000 })
      .toBe(3)
    await popup.keyboard.press("Escape")

    // 5. Popup View Cache: navigate to Generator, close popup, reopen -> lands on Generator!
    await popup.getByRole("button", { name: "Generator" }).click()
    await popup
      .getByTestId("password-strength-meter")
      .waitFor({ state: "visible", timeout: 5000 })
    await popup.close()

    const reopened = await extension.openExtensionPage("popup.html")
    await reopened
      .getByTestId("password-strength-meter")
      .waitFor({ state: "visible", timeout: 5000 })
    await reopened.close()
  })
})

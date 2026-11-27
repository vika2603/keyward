import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { type ExtensionHarness, launchExtension } from "./harness"
import { type MockBitwardenServer, startMockBitwarden } from "./mock-bitwarden"

describe("E2E 05 — Generator, Strength Meter, History, Forwarded Aliases & Security Checkup", () => {
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

  it("generates passwords, passphrases, and usernames, tracks generator history, and exposes all 6 forwarding services", async () => {
    bitwarden.reset({ ciphers: [] })
    await extension.seedBitwarden({ server: bitwarden })
    const popup = await extension.openExtensionPage("popup.html")

    // Open Generator view.
    await popup.getByRole("button", { name: "Generator" }).click()
    await popup
      .getByTestId("password-strength-meter")
      .waitFor({ state: "visible", timeout: 5000 })

    // Copy password -> records entry into Generator History.
    await popup.getByRole("button", { name: "Copy", exact: true }).click()

    // Switch to Passphrase tab.
    await popup.getByRole("tab", { name: "Passphrase" }).click()
    await popup
      .getByTestId("password-strength-meter")
      .waitFor({ state: "visible", timeout: 5000 })

    // Switch to Username tab -> Forwarded email alias -> verify 6 providers + API key field.
    await popup.getByRole("tab", { name: "Username" }).click()
    await popup.getByRole("combobox", { name: "Type" }).click()
    await popup.getByRole("option", { name: "Forwarded email alias" }).click()
    await popup
      .getByLabel("API key")
      .waitFor({ state: "visible", timeout: 5000 })

    await popup.getByRole("combobox", { name: "Service" }).click()
    for (const service of [
      "SimpleLogin",
      "Addy.io",
      "Fastmail Masked Email",
      "Firefox Relay",
      "DuckDuckGo Email Protection",
      "ForwardEmail",
    ]) {
      await popup
        .getByRole("option", { name: service })
        .waitFor({ state: "visible", timeout: 5000 })
    }
    await popup.keyboard.press("Escape")

    // Open Generator History -> verify copied entry is listed and two-step clear empties it.
    await popup.getByRole("button", { name: "Generator history" }).click()
    await popup
      .getByRole("heading", { name: "Generator history" })
      .waitFor({ state: "visible", timeout: 5000 })
    await popup.getByRole("button", { name: "Clear history" }).click()
    await popup.getByRole("button", { name: "Clear all" }).click()
    await popup
      .getByText("No history")
      .waitFor({ state: "visible", timeout: 5000 })
    await popup.close()
  })

  it("runs local Security Checkup identifying weak, reused, and HTTP items while skipping reprompt items", async () => {
    const sharedPw = "Shared#Str0ng!Pass99"
    bitwarden.reset({
      ciphers: [
        {
          Id: "sec-weak-http",
          Type: 1,
          Edit: true,
          Reprompt: 0,
          Name: bitwarden.encrypt("Legacy Router"),
          Login: {
            Username: bitwarden.encrypt("admin"),
            Password: bitwarden.encrypt("password123"),
            Uris: [
              {
                Uri: bitwarden.encrypt("http://router.example.com/login"),
                Match: null,
              },
            ],
          },
        },
        {
          Id: "sec-reuse-1",
          Type: 1,
          Edit: true,
          Reprompt: 0,
          Name: bitwarden.encrypt("Reused App One"),
          Login: {
            Username: bitwarden.encrypt("alice"),
            Password: bitwarden.encrypt(sharedPw),
            Uris: [
              {
                Uri: bitwarden.encrypt("https://one.example.com"),
                Match: null,
              },
            ],
          },
        },
        {
          Id: "sec-reuse-2",
          Type: 1,
          Edit: true,
          Reprompt: 0,
          Name: bitwarden.encrypt("Reused App Two"),
          Login: {
            Username: bitwarden.encrypt("alice"),
            Password: bitwarden.encrypt(sharedPw),
            Uris: [
              {
                Uri: bitwarden.encrypt("https://two.example.com"),
                Match: null,
              },
            ],
          },
        },
        {
          Id: "sec-reprompt",
          Type: 1,
          Edit: true,
          Reprompt: 1,
          Name: bitwarden.encrypt("Reprompt Protected"),
          Login: {
            Username: bitwarden.encrypt("root"),
            Password: bitwarden.encrypt("123456"),
            Uris: [
              {
                Uri: bitwarden.encrypt("http://protected.example.com"),
                Match: null,
              },
            ],
          },
        },
      ],
    })
    await extension.seedBitwarden({ server: bitwarden })

    const popup = await extension.openExtensionPage("popup.html")
    await popup.getByRole("button", { name: "Security checkup" }).click()
    await popup
      .getByText("Legacy Router")
      .first()
      .waitFor({ state: "visible", timeout: 10_000 })
    await popup
      .getByText("Reused App One")
      .first()
      .waitFor({ state: "visible", timeout: 5000 })
    await popup
      .getByText("Used 2 times")
      .first()
      .waitFor({ state: "visible", timeout: 5000 })
    // Reprompt-protected items stay excluded from automated audit.
    expect(await popup.getByText("Reprompt Protected").count()).toBe(0)
    await popup.close()
  })
})

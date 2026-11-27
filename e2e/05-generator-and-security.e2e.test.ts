import http from "node:http"
import type { Page } from "playwright-core"
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

  /** The generator history as stored, for checking which values entered it. */
  const historyText = () =>
    extension.serviceWorker.evaluate(async () => {
      const { storage } = (
        globalThis as unknown as {
          chrome: {
            storage: {
              local: { get(key: string): Promise<Record<string, unknown>> }
            }
          }
        }
      ).chrome
      return JSON.stringify(await storage.local.get("generator.history"))
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

    // The value shown on opening stays in the history when another replaces it at once.
    const generatedValue = popup.getByTestId("generated-value")
    const opened = (await generatedValue.textContent()) ?? ""
    expect(opened).not.toBe("")
    await popup.getByRole("button", { name: "Regenerate" }).click()
    await expect.poll(() => generatedValue.textContent()).not.toBe(opened)
    await expect.poll(historyText).toContain(opened)

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

  it("keeps a forwarding API key encrypted in the Bitwarden account and asks to unlock it", async () => {
    const API_KEY = "sl-e2e-api-key"
    const keysReceived: string[] = []
    const simpleLogin = http.createServer((request, response) => {
      keysReceived.push(String(request.headers.authentication))
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ email: "alias-1@sl.test" }))
    })
    await new Promise<void>((resolve) =>
      simpleLogin.listen(0, "127.0.0.1", resolve),
    )
    const address = simpleLogin.address()
    const serverUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`
    const storedText = (area: "local" | "session") =>
      extension.serviceWorker.evaluate(async (name) => {
        const { storage } = (
          globalThis as unknown as {
            chrome: {
              storage: Record<
                "local" | "session",
                { get(keys: null): Promise<unknown> }
              >
            }
          }
        ).chrome
        return JSON.stringify(await storage[name].get(null))
      }, area)
    const openForwarding = async (): Promise<Page> => {
      const page = await extension.openExtensionPage("popup.html")
      page.setDefaultTimeout(5000)
      await page.getByRole("button", { name: "Generator" }).click()
      await page.getByRole("tab", { name: "Username" }).click()
      await page.getByRole("combobox", { name: "Type" }).click()
      await page.getByRole("option", { name: "Forwarded email alias" }).click()
      return page
    }

    try {
      await extension.clearStorage()
      bitwarden.reset({ ciphers: [] })
      await extension.seedBitwarden({ server: bitwarden, name: "Personal BW" })
      let popup = await openForwarding()
      await popup.getByText("Saved encrypted in Personal BW").waitFor()
      await popup.getByLabel("API key").fill(API_KEY)
      await popup.getByLabel("Server URL (optional)").fill(serverUrl)
      await expect
        .poll(() => storedText("local"))
        .toContain("bitwarden.secrets.")
      expect(await storedText("local")).not.toContain(API_KEY)
      expect(await storedText("session")).not.toContain(API_KEY)

      await popup.getByRole("button", { name: "Generate alias" }).click()
      await popup.getByText("alias-1@sl.test").waitFor()
      expect(keysReceived).toEqual([API_KEY])
      await popup.close()

      // Locked, the key cannot be read; unlocking from the generator brings it back.
      popup = await extension.openExtensionPage("popup.html")
      popup.setDefaultTimeout(5000)
      // The popup reopens on the generator it was closed on.
      await popup.getByRole("button", { name: "Back" }).click()
      await popup.getByRole("button", { name: "Lock all" }).click()
      await popup.getByText("Unlock Bitwarden").waitFor({ timeout: 10_000 })
      await popup.close()
      popup = await openForwarding()
      await popup
        .getByText("Unlock Personal BW to use the API keys saved there")
        .waitFor()
      await popup.getByRole("button", { name: "Unlock" }).click()
      await popup.getByLabel("Master password").fill(bitwarden.masterPassword)
      await popup.getByRole("button", { name: "Unlock" }).click()
      await expect
        .poll(() => popup.getByLabel("API key").inputValue(), {
          timeout: 10_000,
        })
        .toBe(API_KEY)
      await popup.close()

      // Without a Bitwarden account the key lasts for the browser session only.
      await extension.clearStorage()
      popup = await openForwarding()
      await popup.getByText("Kept until the browser closes").waitFor()
      await popup.getByLabel("API key").fill(API_KEY)
      await expect.poll(() => storedText("session")).toContain(API_KEY)
      expect(await storedText("local")).not.toContain(API_KEY)
      await popup.close()
    } finally {
      await new Promise((resolve) => simpleLogin.close(resolve))
    }
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

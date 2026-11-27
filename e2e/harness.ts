import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { type BrowserContext, chromium, type Worker } from "playwright-core"
import type { StoredAccount } from "@/lib/providers/bitwarden/account-store"

const EXTENSION_DIR = path.resolve(import.meta.dirname, "../.output/chrome-mv3")

/**
 * Resolves a Chrome for Testing / Chromium binary for headless extension testing.
 * Checks PLAYWRIGHT_CHROMIUM_EXECUTABLE first, then Playwright's local browser cache.
 */
export function findChromiumExecutable(): string {
  const fromEnv = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?.trim()
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv

  const cacheRoots = [
    path.join(os.homedir(), "Library/Caches/ms-playwright"),
    path.join(os.homedir(), ".cache/ms-playwright"),
  ]
  const relativeCandidates = [
    "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "chrome-linux/chrome",
  ]
  for (const root of cacheRoots) {
    if (!fs.existsSync(root)) continue
    const dirs = fs
      .readdirSync(root)
      .filter((entry) => entry.startsWith("chromium-"))
      .sort()
      .reverse()
    for (const dir of dirs) {
      for (const relative of relativeCandidates) {
        const candidate = path.join(root, dir, relative)
        if (fs.existsSync(candidate)) return candidate
      }
    }
  }
  return chromium.executablePath()
}

export interface ExtensionHarness {
  context: BrowserContext
  serviceWorker: Worker
  extensionId: string
  seedBitwarden: (input: {
    account: StoredAccount
    userKeyBase64: string
    syncData: Record<string, unknown>
    settings?: Record<string, unknown>
  }) => Promise<void>
  clearBitwarden: (settings?: Record<string, unknown>) => Promise<void>
  close: () => Promise<void>
}

/**
 * Launches headless Chrome for Testing with Keyward's built MV3 extension loaded in an isolated
 * temporary profile (never touches the user's Chrome or steals window focus).
 */
export async function launchExtension(): Promise<ExtensionHarness> {
  if (!fs.existsSync(path.join(EXTENSION_DIR, "manifest.json"))) {
    throw new Error(
      `Missing extension build at ${EXTENSION_DIR}. Run "pnpm build" before E2E tests.`,
    )
  }
  const executablePath = findChromiumExecutable()
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "keyward-e2e-"))

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    executablePath,
    args: [
      `--disable-extensions-except=${EXTENSION_DIR}`,
      `--load-extension=${EXTENSION_DIR}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
  })

  let serviceWorker = context.serviceWorkers()[0]
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent("serviceworker", {
      timeout: 15_000,
    })
  }
  const extensionId = new URL(serviceWorker.url()).host

  const seedBitwarden: ExtensionHarness["seedBitwarden"] = async ({
    account,
    userKeyBase64,
    syncData,
    settings,
  }) => {
    await serviceWorker.evaluate(
      async ({
        account: storedAccount,
        userKeyBase64: key,
        syncData: sync,
        settings: nextSettings,
      }) => {
        const storage = (
          globalThis as unknown as {
            chrome: {
              storage: {
                local: {
                  clear(): Promise<void>
                  set(items: Record<string, unknown>): Promise<void>
                }
                session: {
                  clear(): Promise<void>
                  set(items: Record<string, unknown>): Promise<void>
                }
              }
            }
          }
        ).chrome.storage
        const now = Date.now()
        await storage.local.clear()
        await storage.session.clear()
        await storage.local.set({
          "bitwarden.accounts": [storedAccount],
          [`bitwarden.sync.${storedAccount.id}`]: { syncedAt: now, data: sync },
          [`bitwarden.syncedAt.${storedAccount.id}`]: now,
          settings: {
            appleEnabled: false,
            menuTrigger: "focus",
            takeOverPasskeys: true,
            askSave: true,
            askUpdate: true,
            language: "en",
            ...(nextSettings ?? {}),
          },
          "sources.changedAt": now,
        })
        await storage.session.set({
          [`bitwarden.session.${storedAccount.id}`]: {
            userKey: key,
            accessToken: "e2e-token",
            accessTokenExpiresAt: now + 3_600_000,
            refreshToken: "e2e-refresh",
          },
        })
      },
      { account, userKeyBase64, syncData, settings },
    )
  }

  const clearBitwarden: ExtensionHarness["clearBitwarden"] = async (
    settings,
  ) => {
    await serviceWorker.evaluate(
      async ({ settings: nextSettings }) => {
        const storage = (
          globalThis as unknown as {
            chrome: {
              storage: {
                local: {
                  clear(): Promise<void>
                  set(items: Record<string, unknown>): Promise<void>
                }
                session: {
                  clear(): Promise<void>
                  set(items: Record<string, unknown>): Promise<void>
                }
              }
            }
          }
        ).chrome.storage
        await storage.local.clear()
        await storage.session.clear()
        await storage.local.set({
          settings: {
            appleEnabled: false,
            menuTrigger: "focus",
            takeOverPasskeys: true,
            language: "en",
            ...(nextSettings ?? {}),
          },
          "sources.changedAt": Date.now(),
        })
      },
      { settings },
    )
  }

  const close = async () => {
    await context.close().catch(() => {})
    fs.rmSync(profileDir, { recursive: true, force: true })
  }

  return {
    context,
    serviceWorker,
    extensionId,
    seedBitwarden,
    clearBitwarden,
    close,
  }
}

export interface TestSiteServer {
  origin: string
  close: () => Promise<void>
}

const LOGIN_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Keyward E2E Login</title></head>
  <body>
    <form id="login-form" method="post" action="/api/login-ok">
      <label for="username">Username</label>
      <input id="username" name="username" type="email" autocomplete="username" />
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" />
      <label for="company-code">Company Code</label>
      <input id="company-code" name="company-code" type="text" />
      <button id="submit-ok" type="submit">Sign in</button>
    </form>
    <form id="fail-form" method="post" action="/api/login-fail">
      <label for="fail-user">Fail Username</label>
      <input id="fail-user" name="username" type="text" autocomplete="username" />
      <label for="fail-pass">Fail Password</label>
      <input id="fail-pass" name="password" type="password" autocomplete="current-password" />
      <button id="submit-fail" type="submit">Fail Sign in</button>
    </form>
    <script>
      document.getElementById("login-form").addEventListener("submit", async (event) => {
        event.preventDefault()
        await fetch("/api/login-ok", { method: "POST", body: JSON.stringify({ ok: true }) })
      })
      document.getElementById("fail-form").addEventListener("submit", async (event) => {
        event.preventDefault()
        await fetch("/api/login-fail", { method: "POST", body: JSON.stringify({ ok: false }) })
      })
    </script>
  </body>
</html>`

const SIGNUP_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Keyward E2E Signup</title></head>
  <body>
    <form id="signup-form" method="post" action="/api/signup-ok">
      <label for="signup-user">Email</label>
      <input id="signup-user" name="email" type="email" autocomplete="username" />
      <label for="new-pass">New password</label>
      <input id="new-pass" name="new_password" type="password" autocomplete="new-password" />
      <label for="confirm-pass">Confirm password</label>
      <input id="confirm-pass" name="confirm_password" type="password" autocomplete="new-password" />
      <button id="submit-signup" type="submit">Create account</button>
    </form>
    <script>
      document.getElementById("signup-form").addEventListener("submit", async (event) => {
        event.preventDefault()
        await fetch("/api/signup-ok", { method: "POST", body: JSON.stringify({ created: true }) })
      })
    </script>
  </body>
</html>`

const PASSKEY_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Keyward E2E Passkey</title></head>
  <body>
    <form id="passkey-form">
      <label for="pk-user">Username</label>
      <input id="pk-user" name="username" type="text" autocomplete="username webauthn" />
      <label for="pk-pass">Password</label>
      <input id="pk-pass" name="password" type="password" autocomplete="current-password" />
      <button type="submit">Sign in</button>
    </form>
    <script>
      window.__passkeyResult = null
      window.__passkeyError = null
      window.__startConditional = () => {
        const challenge = new Uint8Array([11, 22, 33, 44, 55, 66, 77, 88])
        navigator.credentials.get({
          mediation: "conditional",
          publicKey: {
            rpId: "localhost",
            challenge,
            userVerification: "preferred",
          },
        }).then(
          (credential) => {
            window.__passkeyResult = credential ? credential.toJSON() : null
          },
          (error) => {
            window.__passkeyError = error ? String(error.name || error) : "unknown"
          },
        )
      }
      window.__startConditional()
    </script>
  </body>
</html>`

/** Starts a local HTTP test site served on `http://localhost:<port>` (secure context in Chrome). */
export async function startTestSite(): Promise<TestSiteServer> {
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname
    if (pathname === "/login") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      response.end(LOGIN_HTML)
      return
    }
    if (pathname === "/signup") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      response.end(SIGNUP_HTML)
      return
    }
    if (pathname === "/passkey") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      response.end(PASSKEY_HTML)
      return
    }
    if (pathname === "/api/login-ok" || pathname === "/api/signup-ok") {
      response.writeHead(200, { "Content-Type": "application/json" })
      response.end(JSON.stringify({ ok: true }))
      return
    }
    if (pathname === "/api/login-fail") {
      response.writeHead(401, { "Content-Type": "application/json" })
      response.end(JSON.stringify({ error: "Invalid credentials" }))
      return
    }
    response.writeHead(404)
    response.end("Not Found")
  })

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === "string")
    throw new Error("Could not bind test HTTP server")

  return {
    origin: `http://localhost:${address.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
  }
}

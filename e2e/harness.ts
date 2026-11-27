import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  type BrowserContext,
  chromium,
  type Page,
  type Worker,
} from "playwright-core"
import type { StoredAccount } from "@/lib/providers/bitwarden/account-store"
import type { MockBitwardenServer } from "./mock-bitwarden"

const EXTENSION_DIR = path.resolve(import.meta.dirname, "../.output/chrome-mv3")

/** Must exceed overlay-frame's SETTLE_MS (500ms) + IntersectionObserver delay (100ms). */
export const OVERLAY_SETTLE_WAIT_MS = 850

/**
 * Resolves a Chrome for Testing / Chromium binary for headless extension testing.
 * Checks PLAYWRIGHT_CHROMIUM_EXECUTABLE first, then Playwright's local browser cache.
 */
export function findChromiumExecutable(): string {
  const fromEnv = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?.trim()
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv

  const defaultExecutable = chromium.executablePath()
  if (defaultExecutable && fs.existsSync(defaultExecutable))
    return defaultExecutable

  const cacheRoots = [
    path.join(os.homedir(), "Library/Caches/ms-playwright"),
    path.join(os.homedir(), ".cache/ms-playwright"),
  ]
  const relativeCandidates = [
    "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "chrome-linux64/chrome",
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
  return defaultExecutable
}

export interface ExtensionHarness {
  context: BrowserContext
  serviceWorker: Worker
  extensionId: string
  extensionUrl: (pagePath: string) => string
  seedBitwarden: (input: {
    server: MockBitwardenServer
    unlocked?: boolean
    name?: string
    settings?: Record<string, unknown>
  }) => Promise<string>
  clearStorage: (settings?: Record<string, unknown>) => Promise<void>
  openExtensionPage: (pagePath: string) => Promise<Page>
  close: () => Promise<void>
}

interface ChromeStorageGlobal {
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
      "--disable-dev-shm-usage",
    ],
  })

  let serviceWorker = context.serviceWorkers()[0]
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent("serviceworker", {
      timeout: 15_000,
    })
  }
  const extensionId = new URL(serviceWorker.url()).host
  const extensionUrl = (pagePath: string) =>
    `chrome-extension://${extensionId}/${pagePath.replace(/^\//, "")}`

  const seedBitwarden: ExtensionHarness["seedBitwarden"] = async ({
    server,
    unlocked = true,
    name = "E2E Vault",
    settings,
  }) => {
    const accountId = `${server.url}|${server.userId}`
    const account: StoredAccount = {
      id: accountId,
      userId: server.userId,
      email: server.email,
      name,
      server: server.url,
      kdf: { type: 0, iterations: 5000 },
      salt: server.email.toLowerCase(),
      wrappedUserKey: server.wrappedUserKey,
      encryptedRefreshToken: server.encrypt("mock-refresh-token") ?? "",
    }
    const syncData = {
      Profile: {
        Id: server.userId,
        Email: server.email,
        Organizations: server.state.organizations,
      },
      Folders: server.state.folders,
      Collections: server.state.collections,
      Ciphers: server.state.ciphers,
      Domains: {
        EquivalentDomains: server.state.equivalentDomains,
        GlobalEquivalentDomains: [],
      },
    }
    await serviceWorker.evaluate(
      async ({
        storedAccount,
        userKeyBase64,
        sync,
        isUnlocked,
        nextSettings,
      }) => {
        const storage = (globalThis as unknown as ChromeStorageGlobal).chrome
          .storage
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
            httpAuth: true,
            language: "en",
            ...(nextSettings ?? {}),
          },
          "sources.changedAt": now,
        })
        if (isUnlocked) {
          await storage.session.set({
            [`bitwarden.session.${storedAccount.id}`]: {
              userKey: userKeyBase64,
              accessToken: "e2e-token",
              accessTokenExpiresAt: now + 3_600_000,
              refreshToken: "mock-refresh-token",
            },
          })
        }
      },
      {
        storedAccount: account,
        userKeyBase64: server.userKey.toBase64(),
        sync: syncData,
        isUnlocked: unlocked,
        nextSettings: settings,
      },
    )
    return accountId
  }

  const clearStorage: ExtensionHarness["clearStorage"] = async (settings) => {
    await serviceWorker.evaluate(
      async ({ nextSettings }) => {
        const storage = (globalThis as unknown as ChromeStorageGlobal).chrome
          .storage
        await storage.local.clear()
        await storage.session.clear()
        await storage.local.set({
          settings: {
            appleEnabled: false,
            menuTrigger: "focus",
            takeOverPasskeys: true,
            askSave: true,
            askUpdate: true,
            httpAuth: true,
            language: "en",
            ...(nextSettings ?? {}),
          },
          "sources.changedAt": Date.now(),
        })
      },
      { nextSettings: settings },
    )
  }

  const openExtensionPage = async (pagePath: string): Promise<Page> => {
    const page = await context.newPage()
    await page.goto(extensionUrl(pagePath), { waitUntil: "networkidle" })
    return page
  }

  const close = async () => {
    await context.close().catch(() => {})
    fs.rmSync(profileDir, { recursive: true, force: true })
  }

  return {
    context,
    serviceWorker,
    extensionId,
    extensionUrl,
    seedBitwarden,
    clearStorage,
    openExtensionPage,
    close,
  }
}

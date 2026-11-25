import { vi } from "vitest"
import type {
  Credential,
  ExistingLogin,
  LoginSummary,
  OneTimeCode,
  VaultInfo,
  VaultProvider,
} from "@/lib/providers/types"
import type { Providers } from "./providers"

/** URLs of frames, keyed by "tabId:frameId", which the mocked `frameUrl` reads. */
export const frames = new Map<string, string>()

export function setFrame(tabId: number, frameId: number, url: string): void {
  frames.set(`${tabId}:${frameId}`, url)
}

/** A stand-in for the `./page` module; tests pass it to `vi.mock`. */
export const pageModule = {
  frameUrl: vi.fn(async (tabId: number, frameId: number) => {
    const url = frames.get(`${tabId}:${frameId}`)
    return url ? new URL(url) : null
  }),
  sendToFrame: vi.fn(
    async (_tabId: number, _frameId: number, _message: unknown) =>
      undefined as unknown,
  ),
  activeTab: vi.fn(),
  webPage: (url: string | undefined) => (url ? new URL(url) : null),
}

export interface FakeVault {
  info: VaultInfo
  existing?: ExistingLogin | null
  credential?: Credential
  /** Logins listed for any page while the vault is ready. */
  logins?: LoginSummary[]
  /** Whether the vault stores logins for any address; true when left out. */
  canSave?: boolean
  /** Logins with one-time codes listed for any page. */
  codeLogins?: LoginSummary[]
  code?: OneTimeCode
}

/** Providers with fixed vaults; each vault answers from its fake and records saves. */
export function fakeProviders(vaults: FakeVault[]) {
  const calls = {
    save: vi.fn(),
    update: vi.fn(),
    credential: vi.fn(),
    oneTimeCode: vi.fn(),
  }
  const providerFor = (vault: FakeVault): VaultProvider => ({
    kind: vault.info.kind,
    vaults: async () => [vault.info],
    logins: async () => [],
    search: async () => [],
    credential: async (...args) => {
      calls.credential(...args)
      if (!vault.credential) throw new Error("no credential")
      return vault.credential
    },
    details: async () => {
      throw new Error("no details")
    },
    codeLogins: async () => vault.codeLogins ?? [],
    oneTimeCode: async (...args) => {
      calls.oneTimeCode(...args)
      if (!vault.code) throw new Error("no code")
      return vault.code
    },
    canSave: () => vault.canSave ?? true,
    save: async (...args) => {
      calls.save(...args)
    },
    update: async (...args) => {
      calls.update(...args)
    },
    findExisting: async () => vault.existing ?? null,
    lock: async () => {},
    lockAll: async () => {},
  })
  const byId = new Map(
    vaults.map((vault) => [vault.info.id, providerFor(vault)]),
  )
  const loginsForPage = async () =>
    vaults.map((vault) => ({
      ...vault.info,
      logins: vault.info.status === "ready" ? (vault.logins ?? []) : [],
    }))
  const providers = {
    vaultsForPage: async () => vaults.map((vault) => vault.info),
    loginsForPage,
    codeLoginsForPage: async () =>
      vaults.map((vault) => ({
        ...vault.info,
        logins: vault.info.status === "ready" ? (vault.codeLogins ?? []) : [],
      })),
    vaults: async () => vaults.map((vault) => vault.info),
    vault: async (id: string) => {
      const found = vaults.find((vault) => vault.info.id === id)
      if (!found) throw new Error("unknown vault")
      return found.info
    },
    providerOf: (id: string) => {
      const provider = byId.get(id)
      if (!provider) throw new Error("unknown vault")
      return provider
    },
  } as unknown as Providers
  return { providers, calls }
}

export const appleVault: VaultInfo = {
  id: "apple",
  kind: "apple",
  label: "Apple Passwords",
  status: "ready",
}

export const accountVault: VaultInfo = {
  id: "bitwarden:a",
  kind: "bitwarden",
  label: "someone@example.com",
  status: "ready",
}

import { vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { AppleProvider } from "@/lib/providers/apple/apple-provider"
import { BitwardenProvider } from "@/lib/providers/bitwarden/bitwarden-provider"
import type {
  CodeSetup,
  Credential,
  ExistingLogin,
  LoginSummary,
  OneTimeCode,
  VaultInfo,
  VaultProvider,
} from "@/lib/providers/types"
import type { SiteBehavior, SiteRule } from "@/lib/settings"
import type { NamedProviders } from "./handlers"
import type { Providers } from "./providers"

/** URLs of frames, keyed by "tabId:frameId", which the mocked `frameUrl` reads. */
export const frames = new Map<string, string>()

export function setFrame(tabId: number, frameId: number, url: string): void {
  frames.set(`${tabId}:${frameId}`, url)
}

/** Resets the fake browser, the frames the page stand-in knows and the calls of every mock. */
export function resetBackground(): void {
  fakeBrowser.reset()
  frames.clear()
  vi.clearAllMocks()
}

type MenuClick = (
  info: { menuItemId: string; frameId?: number },
  tab?: { id?: number; url?: string },
) => unknown

/** A context menu as the code under test created it. */
export interface CreatedMenu {
  id: string
  parentId?: string
  title?: string
  type?: string
  enabled?: boolean
  contexts?: string[]
}

/**
 * Gives the fake browser the context menu functions it leaves out. `created` lists the menus made
 * since; `click` reports a click to the listener registered last, as the browser would.
 */
export function fakeContextMenus(): {
  created: CreatedMenu[]
  click: MenuClick
} {
  const created: CreatedMenu[] = []
  let listener: MenuClick = () => {}
  const menus = fakeBrowser.contextMenus as unknown as Record<string, unknown>
  menus.create = vi.fn((properties: CreatedMenu, done?: () => void) => {
    created.push(properties)
    done?.()
  })
  menus.update = vi.fn(async () => {})
  menus.remove = vi.fn(async () => {})
  menus.onClicked = {
    addListener: (added: MenuClick) => {
      listener = added
    },
  }
  return {
    created,
    click: (...click) => listener(...click),
  }
}

/** A rule for example.com that applies to every vault with the default match. */
export function siteRule(
  behavior: SiteBehavior,
  rule: Partial<SiteRule> = {},
): SiteRule {
  return {
    id: "rule",
    host: "example.com",
    match: null,
    provider: "all",
    behavior,
    ...rule,
  }
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
  /** Whether the user told the vault never to save logins for the site. */
  refusesSaving?: boolean
  /** Logins with one-time codes listed for any page. */
  codeLogins?: LoginSummary[]
  code?: OneTimeCode
  /** How the vault takes an authenticator key; it takes none when left out. */
  codeSetup?: CodeSetup
}

/** Providers with fixed vaults; each vault answers from its fake and records saves. */
export function fakeProviders(vaults: FakeVault[]) {
  const calls = {
    save: vi.fn(),
    update: vi.fn(),
    credential: vi.fn(),
    oneTimeCode: vi.fn(),
    setUpCode: vi.fn(),
  }
  const providerFor = (vault: FakeVault): VaultProvider => ({
    kind: vault.info.kind,
    ownsVault: (vaultId) => vaultId === vault.info.id,
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
    codeSetup: () => vault.codeSetup ?? null,
    setUpCode: async (...args) => {
      calls.setUpCode(...args)
    },
    refusesSaving: async () => vault.refusesSaving ?? false,
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
    savable: async () =>
      vaults
        .map((vault) => vault.info)
        .filter((info) => info.status === "ready"),
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

/**
 * The named providers for tests of other requests. Neither reaches a helper, a server or the
 * vault crypto until one of its own requests asks it to.
 */
export function idleNamedProviders(): NamedProviders {
  return {
    apple: new AppleProvider(),
    bitwarden: new BitwardenProvider(() =>
      Promise.reject(new Error("These tests load no vault crypto")),
    ),
  }
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

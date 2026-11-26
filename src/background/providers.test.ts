import { beforeEach, describe, expect, it } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { vaultIdOf } from "@/lib/providers/bitwarden/vault-id"
import type {
  LoginSummary,
  VaultInfo,
  VaultProvider,
} from "@/lib/providers/types"
import { Providers } from "./providers"

const VAULT: VaultInfo = {
  id: vaultIdOf("account"),
  kind: "bitwarden",
  label: "someone@example.com",
  status: "ready",
}

/** A provider whose methods read its own fields, as the real ones do. */
class ListingProvider {
  readonly kind = "bitwarden"
  private readonly logins: LoginSummary[] = [
    { id: "item-1", username: "someone", title: "Example" },
  ]

  ownsVault(vaultId: string): boolean {
    return vaultId === VAULT.id
  }

  async vaults(): Promise<VaultInfo[]> {
    return [VAULT]
  }

  async allItems(_vaultId: string) {
    return { logins: this.logins, notes: [] }
  }
}

const noVaults = { ownsVault: () => false, vaults: async () => [] }

describe("Providers.allItems", () => {
  it("lists a whole vault through its provider", async () => {
    const providers = new Providers([
      noVaults,
      new ListingProvider(),
    ] as unknown as VaultProvider[])
    const [view] = await providers.allItems()
    expect(view?.error).toBeUndefined()
    expect(view?.logins.map((login) => login.id)).toEqual(["item-1"])
  })
})

describe("Providers.loginsForPage", () => {
  beforeEach(() => fakeBrowser.reset())

  it("marks a vault that is not open when it keeps logins for the page", async () => {
    const locked: VaultInfo = {
      id: "apple",
      kind: "apple",
      label: "Passwords",
      status: "locked",
    }
    const provider = {
      ownsVault: (vaultId: string) => vaultId === locked.id,
      vaults: async () => [locked],
      keepsLoginsFor: async (_vaultId: string, page: URL) =>
        page.hostname === "github.com",
    }
    const providers = new Providers([provider] as unknown as VaultProvider[])
    const [kept] = await providers.loginsForPage(
      new URL("https://github.com/login"),
    )
    const [other] = await providers.loginsForPage(
      new URL("https://example.com/"),
    )
    expect(kept?.keepsPageLogins).toBe(true)
    expect(other?.keepsPageLogins).toBeUndefined()
  })
})

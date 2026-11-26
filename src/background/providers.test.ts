import { describe, expect, it } from "vitest"
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

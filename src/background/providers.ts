import { ruleForHost } from "@/lib/matching"
import type { AppleProvider } from "@/lib/providers/apple/apple-provider"
import { APPLE_VAULT_ID } from "@/lib/providers/apple/vault-id"
import type { BitwardenProvider } from "@/lib/providers/bitwarden/bitwarden-provider"
import { isBitwardenVault } from "@/lib/providers/bitwarden/vault-id"
import {
  type ListOptions,
  type LoginSummary,
  type TabRef,
  VaultError,
  type VaultInfo,
  type VaultProvider,
} from "@/lib/providers/types"
import { getSettings } from "@/lib/settings"
import type { VaultView } from "./api"

/** All providers behind one lookup by vault ID. Apple comes first, then accounts in sign-in order. */
export class Providers {
  constructor(
    readonly apple: AppleProvider,
    readonly bitwarden: BitwardenProvider,
  ) {}

  private get all(): VaultProvider[] {
    return [this.apple, this.bitwarden]
  }

  providerOf(vaultId: string): VaultProvider {
    if (vaultId === APPLE_VAULT_ID) return this.apple
    if (isBitwardenVault(vaultId)) return this.bitwarden
    throw new VaultError("Unknown vault", "unknownVault")
  }

  async vaults(): Promise<VaultInfo[]> {
    return (
      await Promise.all(this.all.map((provider) => provider.vaults()))
    ).flat()
  }

  /** Vaults a page may use, after the site rule's provider restriction. */
  async vaultsForPage(page: URL): Promise<VaultInfo[]> {
    const settings = await getSettings()
    const rule = ruleForHost(settings.siteRules, page.hostname)
    const vaults = await this.vaults()
    if (!rule || rule.provider === "all") return vaults
    return vaults.filter((vault) => vault.kind === rule.provider)
  }

  async vault(vaultId: string): Promise<VaultInfo> {
    const vault = (await this.vaults()).find(
      (candidate) => candidate.id === vaultId,
    )
    if (!vault) throw new VaultError("Unknown vault", "unknownVault")
    return vault
  }

  /** Every vault with the logins it has for the page; a vault that fails is shown without logins. */
  loginsForPage(page: URL | null, options?: ListOptions): Promise<VaultView[]> {
    return this.listForPage(page, (provider, vaultId, url) =>
      provider.logins(vaultId, url, options),
    )
  }

  /** Every vault with the logins that give one-time codes for the page. */
  codeLoginsForPage(page: URL, tab: TabRef): Promise<VaultView[]> {
    return this.listForPage(page, (provider, vaultId, url) =>
      provider.codeLogins(vaultId, url, tab),
    )
  }

  /** Every vault with its logins and notes that match a search of the whole vault, whatever the page. */
  async search(query: string): Promise<VaultView[]> {
    const views = await this.listEach(
      await this.vaults(),
      (provider, vaultId) => provider.search(vaultId, query),
    )
    return Promise.all(views.map((view) => this.withNotes(view, query)))
  }

  /** The view with the vault's notes that match the query, when the vault keeps notes. */
  private async withNotes(view: VaultView, query: string): Promise<VaultView> {
    const provider = this.providerOf(view.id)
    const searchable = view.status === "ready" && !view.error
    if (!searchable || !provider.searchNotes) return view
    try {
      return { ...view, notes: await provider.searchNotes(view.id, query) }
    } catch {
      // The logins already show; a failed note search leaves the notes out.
      return view
    }
  }

  /** Every item of each ready vault whose provider can list a whole vault. */
  async allItems(): Promise<VaultView[]> {
    const vaults = await this.vaults()
    const listable = vaults.filter(
      (vault) => vault.status === "ready" && this.providerOf(vault.id).allItems,
    )
    return Promise.all(
      listable.map(async (vault): Promise<VaultView> => {
        try {
          const provider = this.providerOf(vault.id)
          const items = await provider.allItems?.(vault.id)
          return { ...vault, logins: items?.logins ?? [], notes: items?.notes }
        } catch (error) {
          if (error instanceof VaultError && error.code === "locked")
            return { ...vault, status: "locked", logins: [] }
          return {
            ...vault,
            logins: [],
            error: error instanceof Error ? error.message : String(error),
          }
        }
      }),
    )
  }

  /** Ready vaults that can store a new secure note. */
  async noteTargets(): Promise<VaultInfo[]> {
    const ready = await this.savable()
    return ready.filter((vault) => this.providerOf(vault.id).saveNote)
  }

  private async listForPage(
    page: URL | null,
    list: (
      provider: VaultProvider,
      vaultId: string,
      page: URL,
    ) => Promise<LoginSummary[]>,
  ): Promise<VaultView[]> {
    if (!page)
      return (await this.vaults()).map((vault) => ({ ...vault, logins: [] }))
    return this.listEach(await this.vaultsForPage(page), (provider, vaultId) =>
      list(provider, vaultId, page),
    )
  }

  private listEach(
    vaults: VaultInfo[],
    list: (provider: VaultProvider, vaultId: string) => Promise<LoginSummary[]>,
  ): Promise<VaultView[]> {
    return Promise.all(
      vaults.map(async (vault) => {
        if (vault.status !== "ready") return { ...vault, logins: [] }
        try {
          return {
            ...vault,
            logins: await list(this.providerOf(vault.id), vault.id),
          }
        } catch (error) {
          if (error instanceof VaultError && error.code === "locked") {
            return { ...vault, status: "locked" as const, logins: [] }
          }
          return {
            ...vault,
            logins: [],
            error: error instanceof Error ? error.message : String(error),
          }
        }
      }),
    )
  }

  /** Vaults a new login can be saved to right now. */
  async savable(): Promise<VaultInfo[]> {
    return (await this.vaults()).filter((vault) => vault.status === "ready")
  }

  async lockAll(): Promise<void> {
    await Promise.all(this.all.map((provider) => provider.lockAll()))
  }
}

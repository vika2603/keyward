import { ruleForHost } from "@/lib/matching"
import {
  type ListOptions,
  type LoginSummary,
  type TabRef,
  VaultError,
  type VaultInfo,
  type VaultProvider,
} from "@/lib/providers/types"
import { getSettings, type SiteRule } from "@/lib/settings"
import type { VaultView } from "./api"

/** The vaults a site rule lets a page use: those of the provider it names, or all of them. */
export function vaultsForRule(
  vaults: VaultInfo[],
  rule: SiteRule | null,
): VaultInfo[] {
  if (!rule || rule.provider === "all") return vaults
  return vaults.filter((vault) => vault.kind === rule.provider)
}

/** A vault whose listing failed: locked when it was locked meanwhile, else shown with the error. */
function failedView(vault: VaultInfo, error: unknown): VaultView {
  if (error instanceof VaultError && error.code === "locked")
    return { ...vault, status: "locked", logins: [] }
  return {
    ...vault,
    logins: [],
    error: error instanceof Error ? error.message : String(error),
  }
}

/** All providers behind one lookup by vault ID; vaults are listed in the order of their providers. */
export class Providers {
  constructor(private readonly all: readonly VaultProvider[]) {}

  providerOf(vaultId: string): VaultProvider {
    const provider = this.all.find((candidate) => candidate.ownsVault(vaultId))
    if (!provider) throw new VaultError("Unknown vault", "unknownVault")
    return provider
  }

  async vaults(): Promise<VaultInfo[]> {
    return (
      await Promise.all(this.all.map((provider) => provider.vaults()))
    ).flat()
  }

  /** Vaults a page may use, after the site rule's provider restriction. */
  async vaultsForPage(page: URL): Promise<VaultInfo[]> {
    const { siteRules } = await getSettings()
    return vaultsForRule(
      await this.vaults(),
      ruleForHost(siteRules, page.hostname),
    )
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
    const ready = (await this.vaults()).filter(
      (vault) => vault.status === "ready",
    )
    const listed = ready.flatMap((vault) => {
      const provider = this.providerOf(vault.id)
      const listAll = provider.allItems?.bind(provider)
      return listAll ? [{ vault, listAll }] : []
    })
    return Promise.all(
      listed.map(async ({ vault, listAll }): Promise<VaultView> => {
        try {
          const items = await listAll(vault.id)
          return {
            ...vault,
            logins: items.logins,
            notes: items.notes,
            groups: items.groups,
            trashed: items.trashed,
          }
        } catch (error) {
          return failedView(vault, error)
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
          return failedView(vault, error)
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

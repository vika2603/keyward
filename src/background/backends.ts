import type { AppleBackend } from "@/lib/backends/apple/apple-backend"
import { APPLE_SOURCE_ID } from "@/lib/backends/apple/source-id"
import type { BitwardenBackend } from "@/lib/backends/bitwarden/bitwarden-backend"
import { isBitwardenSource } from "@/lib/backends/bitwarden/source-id"
import {
  BackendError,
  type PasswordBackend,
  type SourceInfo,
} from "@/lib/backends/types"
import { ruleForHost } from "@/lib/matching"
import { getSettings } from "@/lib/settings"
import type { SourceView } from "./api"

/** All backends behind one lookup by source ID. Apple comes first, then accounts in sign-in order. */
export class Backends {
  constructor(
    readonly apple: AppleBackend,
    readonly bitwarden: BitwardenBackend,
  ) {}

  private get all(): PasswordBackend[] {
    return [this.apple, this.bitwarden]
  }

  backendOf(sourceId: string): PasswordBackend {
    if (sourceId === APPLE_SOURCE_ID) return this.apple
    if (isBitwardenSource(sourceId)) return this.bitwarden
    throw new BackendError("Unknown source", "unknownSource")
  }

  async sources(): Promise<SourceInfo[]> {
    return (await Promise.all(this.all.map((b) => b.sources()))).flat()
  }

  /** Sources a page may use, after the site rule's backend restriction. */
  async sourcesForPage(page: URL): Promise<SourceInfo[]> {
    const settings = await getSettings()
    const rule = ruleForHost(settings.siteRules, page.hostname)
    const sources = await this.sources()
    if (!rule || rule.backend === "all") return sources
    return sources.filter((s) => s.kind === rule.backend)
  }

  async source(sourceId: string): Promise<SourceInfo> {
    const source = (await this.sources()).find((s) => s.id === sourceId)
    if (!source) throw new BackendError("Unknown source", "unknownSource")
    return source
  }

  /** Every source with the logins it has for the page; a source that fails is shown without logins. */
  async loginsForPage(page: URL | null): Promise<SourceView[]> {
    const sources = page
      ? await this.sourcesForPage(page)
      : await this.sources()
    return Promise.all(
      sources.map(async (source) => {
        if (source.status !== "ready" || !page) return { ...source, logins: [] }
        try {
          return {
            ...source,
            logins: await this.backendOf(source.id).logins(source.id, page),
          }
        } catch (error) {
          if (error instanceof BackendError && error.code === "locked") {
            return { ...source, status: "locked" as const, logins: [] }
          }
          return {
            ...source,
            logins: [],
            error: error instanceof Error ? error.message : String(error),
          }
        }
      }),
    )
  }

  /** Sources a new login can be saved to right now. */
  async savable(): Promise<SourceInfo[]> {
    return (await this.sources()).filter((s) => s.status === "ready")
  }

  async lockAll(): Promise<void> {
    await Promise.all(this.all.map((b) => b.lockAll()))
  }
}

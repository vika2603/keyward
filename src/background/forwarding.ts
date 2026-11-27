import { storage } from "wxt/utils/storage"
import {
  emptyForwardingSettings,
  FORWARDING_SERVICES,
  type ForwardingService,
  type ForwardingSettings,
  type SavedForwarding,
} from "@/lib/email-forwarding"
import type { BitwardenProvider } from "@/lib/providers/bitwarden/bitwarden-provider"
import { VaultError } from "@/lib/providers/types"
import { serialQueue } from "@/lib/serial-queue"
import type { ForwardingAccount, ForwardingView } from "./api"

const SECRET_NAME = "emailForwarding"
/** The saved settings are padded to a multiple of this length, so their size says little about the keys. */
const PADDING = 512

/** Without a Bitwarden account nothing can encrypt the settings, so they last for the browser session. */
const sessionItem = storage.defineItem<SavedForwarding>(
  "session:generator.forwarding",
  { fallback: {} },
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function textAt(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === "string" ? value : ""
}

function parseSaved(plain: string): SavedForwarding {
  let parsed: unknown
  try {
    parsed = JSON.parse(plain)
  } catch {
    return {}
  }
  if (!isRecord(parsed)) return {}
  const saved: SavedForwarding = {}
  for (const service of FORWARDING_SERVICES) {
    const settings = parsed[service]
    if (!isRecord(settings)) continue
    saved[service] = {
      apiKey: textAt(settings, "apiKey"),
      domain: textAt(settings, "domain"),
      baseUrl: textAt(settings, "baseUrl"),
    }
  }
  return saved
}

function padded(saved: SavedForwarding): string {
  const json = JSON.stringify(saved)
  // JSON allows trailing white space, so the padding needs no removal.
  return json.padEnd(Math.ceil((json.length + 1) / PADDING) * PADDING)
}

/**
 * The settings of the email forwarding services, which hold API keys. Like Bitwarden's own
 * generator, Keyward keeps them encrypted with a Bitwarden account's user key, so they are read
 * only while that account is unlocked and go when it signs out.
 */
export class ForwardingStore {
  private readonly change = serialQueue()

  constructor(private readonly bitwarden: BitwardenProvider) {}

  /** Where the settings are kept and what they are; `accountId` picks among several accounts. */
  async view(accountId?: string): Promise<ForwardingView> {
    const accounts: ForwardingAccount[] = (await this.bitwarden.accounts()).map(
      ({ id, vaultId, label, unlocked }) => ({
        id,
        vaultId,
        label,
        unlocked,
      }),
    )
    const account =
      accounts.find((candidate) => candidate.id === accountId) ?? accounts[0]
    if (!account)
      return { keeper: "session", saved: await sessionItem.getValue() }
    return {
      keeper: "bitwarden",
      accounts,
      account,
      saved: account.unlocked ? await this.read(account.id) : null,
    }
  }

  save(
    service: ForwardingService,
    settings: ForwardingSettings,
    accountId?: string,
  ): Promise<void> {
    return this.change(async () => {
      const { view, saved } = await this.readable(accountId)
      const next = { ...saved, [service]: settings }
      if (view.keeper === "session") await sessionItem.setValue(next)
      else
        await this.bitwarden.writeSecret(
          view.account.id,
          SECRET_NAME,
          padded(next),
        )
    })
  }

  /** One service's settings, read after the changes saved before. */
  settings(
    service: ForwardingService,
    accountId?: string,
  ): Promise<ForwardingSettings> {
    return this.change(async () => {
      const { saved } = await this.readable(accountId)
      return saved[service] ?? emptyForwardingSettings
    })
  }

  private async readable(
    accountId?: string,
  ): Promise<{ view: ForwardingView; saved: SavedForwarding }> {
    const view = await this.view(accountId)
    if (!view.saved) throw new VaultError("The account is locked", "locked")
    return { view, saved: view.saved }
  }

  /** The account's settings; null when it was locked after it was listed as unlocked. */
  private async read(accountId: string): Promise<SavedForwarding | null> {
    try {
      const plain = await this.bitwarden.readSecret(accountId, SECRET_NAME)
      return plain === null ? {} : parseSaved(plain)
    } catch (error) {
      if (error instanceof VaultError && error.code === "locked") return null
      throw error
    }
  }
}

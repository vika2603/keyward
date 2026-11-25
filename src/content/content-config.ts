import type { ContentScriptContext } from "wxt/utils/content-script-context"
import {
  type ContentConfig,
  callBackground,
  VAULTS_CHANGED_KEY,
} from "@/background/api"
import { ACCOUNTS_KEY } from "@/lib/providers/bitwarden/account-store"
import { listenToExtension } from "./extension-messages"

/** How a frame behaves until the background has configured it. */
const UNCONFIGURED: ContentConfig = {
  active: false,
  scanCodes: false,
  menuTrigger: "click",
  takeOverPasskeys: false,
  theme: "system",
  language: "en",
}

/**
 * This frame's configuration, which follows the settings and the connected vaults. It is asked for
 * again whenever either changes; only the answer to the latest request is applied.
 */
export class ContentConfiguration {
  private config = UNCONFIGURED
  private requests = 0

  constructor(
    private readonly ctx: ContentScriptContext,
    /** Applies a new configuration; `current` already returns it. */
    private readonly apply: (
      config: ContentConfig,
      previous: ContentConfig,
    ) => void,
  ) {
    listenToExtension(
      ctx,
      browser.storage.local.onChanged,
      (changes: Record<string, Browser.storage.StorageChange>) => {
        if (
          changes.settings ||
          changes[ACCOUNTS_KEY] ||
          changes[VAULTS_CHANGED_KEY]
        )
          void this.load()
      },
    )
  }

  get current(): ContentConfig {
    return this.config
  }

  async load(): Promise<void> {
    const request = ++this.requests
    const config = await callBackground("content.init", null).catch(() => null)
    if (!config || request !== this.requests || this.ctx.isInvalid) return
    const previous = this.config
    this.config = config
    this.apply(config, previous)
  }

  /** The answer to a question about this configuration, or null when a newer one was asked for meanwhile. */
  async whileCurrent<T>(answer: Promise<T>): Promise<T | null> {
    const request = this.requests
    const value = await answer
    return request === this.requests ? value : null
  }
}

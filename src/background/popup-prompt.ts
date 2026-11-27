import { VaultError } from "@/lib/providers/types"

/** How long a popup-gated request waits for user action before timing out. */
const CHOICE_MS = 5 * 60_000
/**
 * How long the popup has to connect after `openChooser()` resolves; if the browser never shows it
 * (e.g. headless or blocked), the gate settles with `onShowTimeout` so the site is never stuck.
 */
const SHOW_MS = 5000

interface ActivePrompt<TState, TOutcome> {
  state: TState
  shown: boolean
  answering: boolean
  left: boolean
  settle: (outcome: TOutcome) => void
}

export interface PopupPromptLifecycle {
  showing(): void
  leave(): void
}

/**
 * Reusable single-request gate for background flows that open the extension popup to ask the user
 * for a decision (HTTP basic/digest auth, modal WebAuthn passkeys).
 *
 * Guarantees:
 * - At most one pending prompt at a time.
 * - Automatic fallback if the popup fails to appear within `SHOW_MS`.
 * - Automatic timeout after `CHOICE_MS`.
 * - Safe popup disconnect handling (`leave()` waits if an async answer is already in flight).
 */
export class PopupPromptGate<TState, TOutcome> implements PopupPromptLifecycle {
  private active: ActivePrompt<TState, TOutcome> | null = null

  constructor(
    private readonly openChooser: () => Promise<void>,
    private readonly outcomes: {
      onShowTimeout: () => TOutcome
      onTimeout: () => TOutcome
      onLeave: () => TOutcome
    },
  ) {}

  get current(): TState | null {
    return this.active?.state ?? null
  }

  get busy(): boolean {
    return this.active !== null
  }

  /** Opens the popup and waits until settled by user action, timeout, or disconnect. */
  ask(state: TState): Promise<TOutcome> {
    return new Promise((resolve) => {
      const timer = setTimeout(
        () => entry.settle(this.outcomes.onTimeout()),
        CHOICE_MS,
      )
      const entry: ActivePrompt<TState, TOutcome> = {
        state,
        shown: false,
        answering: false,
        left: false,
        settle: (outcome) => {
          if (this.active !== entry) return
          clearTimeout(timer)
          this.active = null
          resolve(outcome)
        },
      }
      this.active = entry
      this.openChooser().then(
        () =>
          setTimeout(() => {
            if (!entry.shown) entry.settle(this.outcomes.onShowTimeout())
          }, SHOW_MS),
        () => entry.settle(this.outcomes.onShowTimeout()),
      )
    })
  }

  /** Runs an async answer step against the active prompt, ensuring disconnect safety. */
  async answer(compute: (state: TState) => Promise<TOutcome>): Promise<void> {
    const entry = this.active
    if (!entry) throw new VaultError("The site stopped asking", "pageChanged")
    entry.answering = true
    try {
      const outcome = await compute(entry.state)
      if (this.active !== entry)
        throw new VaultError("The site stopped asking", "pageChanged")
      entry.settle(outcome)
    } finally {
      entry.answering = false
      // Settling again is a no-op, so this only releases a prompt whose answer threw after disconnect.
      if (entry.left) entry.settle(this.outcomes.onLeave())
    }
  }

  /** Settles the active prompt immediately, if one exists. */
  settle(outcome: TOutcome): void {
    this.active?.settle(outcome)
  }

  /** Marks the popup as shown once its runtime port connects. */
  showing(): void {
    if (this.active) this.active.shown = true
  }

  /** Called when the popup port disconnects; defers settling if an async answer is still running. */
  leave(): void {
    const entry = this.active
    if (!entry) return
    if (entry.answering) entry.left = true
    else entry.settle(this.outcomes.onLeave())
  }
}

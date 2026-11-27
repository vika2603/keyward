# CLAUDE.md

Keyward is a Chrome MV3 password manager extension (WXT + React + TypeScript + Tailwind/shadcn) bridging multiple vault providers — currently **Apple Passwords** (via macOS native messaging helper) and **Bitwarden** (official WASM crypto SDK) — through one unified `VaultProvider` interface.

## Architecture & Module Boundaries

- `src/lib/` — Pure domain logic, crypto, matching, generator, i18n, passkeys, and providers. No React components or Chrome tab side effects.
  - `src/lib/providers/types.ts` — The `VaultProvider` contract every provider implements. Providers must never import from one another; adding a new provider should not modify existing providers.
  - `src/lib/providers/apple/` — Apple Passwords native helper protocol & provider.
  - `src/lib/providers/bitwarden/` — Bitwarden API client, WASM crypto adapter, sync/offline store, decryption, local security audit (`audit.ts`), passkey queries (`passkeys.ts`), and item helpers (`item-helpers.ts`).
  - `src/lib/passkeys/` — RFC 8949 deterministic CBOR (`cbor.ts`) and WebCrypto ECDSA P-256 WebAuthn authenticator + RP ID validation (`webauthn.ts`).
- `src/background/` — MV3 service worker: request router (`handlers/`), autofill orchestration (`autofill.ts`), save/update prompt & request gating (`save-prompt.ts`, `submission-gate.ts`), modal popup gates (`popup-prompt.ts`, `http-auth.ts`, `passkey-prompt.ts`), and overlay session storage (`overlays.ts`).
- `src/content/` — Isolated content-script DOM detection (`field-finder.ts`, `deep-dom.ts`, `site-fixes.ts`), fill execution (`fill-dom.ts`), submission watching (`submit.ts`), and WebAuthn bridge helpers (`passkey-steering.ts`, `passkey-wire.ts`).
- `src/entrypoints/` — WXT entrypoints: `background.ts`, `content.ts`, `passkeys.content.ts` (`MAIN` world), `popup/`, `options/`, `inline-menu/`, `save-prompt/`, `welcome/`, `connect-passwords/`, `offscreen/`.

## Essential Commands

Use `pnpm` directly for all development, build, and test scripts (`mise` pins Node/pnpm versions and only runs multi-step external dataset tasks):

```bash
pnpm check                 # Lint (src + e2e) + TypeScript check + unit tests
pnpm format                # Auto-format and apply safe Biome fixes (src + e2e)
pnpm compile               # TypeScript strict typecheck (tsc --noEmit)
pnpm test                  # Vitest unit & integration test suite
pnpm build                 # Production MV3 bundle -> .output/chrome-mv3/
pnpm test:e2e              # Headless Chrome for Testing MV3 extension E2E suite
pnpm zip                   # Release archive for Chrome Web Store
mise run corpus            # DuckDuckGo 564-form autofill regression corpus
mise run site-data         # Refresh Apple password-manager-resources rules
```

Always run `pnpm check` and `pnpm build` (plus `pnpm test:e2e` for UI/autofill/passkey changes) before committing. Keep `store/listing.md` untouched unless explicitly editing store copy.

## TypeScript & React Style Guide

Keyward prioritizes clarity and maintainability over cleverness:

1. **Full, descriptive names**: Use complete words for variables, parameters, and helpers (`reader`, `record`, `credential`, `signature`, `byteLength`). Avoid cryptic abbreviations (`rec`, `buf`, `sig`, `pw`, `cred`) and single-letter names outside trivial numeric loop counters (`index` / `i`).
2. **Flat control flow & named conditions**:
   - Prefer early returns over deeply nested `if / else` blocks.
   - Extract multi-clause boolean expressions into descriptive `const` booleans (e.g., `const isLocalHttp = ...`).
   - One conceptual step per line; never write nested ternaries (`lint/style/noNestedTernary` is an error in `biome.json`).
3. **Strict typing without unsafe escapes**:
   - Never introduce `any` or non-null assertions (`!`).
   - At runtime boundaries (message payloads, JSON responses, storage), narrow `unknown` with small type guards (`isRecord`) and explicit validators rather than `as` casts.
   - Use `import type` / `export type` for type-only symbols and `readonly` on pure helper array/collection inputs.
   - Use `unknown` in `catch` blocks and handle errors through `VaultError` + typed `ErrorCode` (`src/lib/error-codes.ts`).
4. **Cohesive modules & thin entrypoints**:
   - Keep entrypoints (`passkeys.content.ts`, `content.ts`, `background/index.ts`) and top-level React views focused on orchestration/layout.
   - Move pure serialization, crypto, domain rules, and multi-section UI blocks into dedicated sibling modules so top-level files read like an outline.
   - Prefer well-maintained libraries over hand-rolling complex algorithms; keep `MAIN`-world scripts (`passkeys.content.ts`) dependency-light to minimize page overhead.
5. **Purposeful comments**:
   - Write short JSDoc on exported functions, types, and non-obvious invariants explaining *why* or the contract — not what the syntax already says.

## Product, UX & Security Invariants

- **Error presentation**: Surface action failures via `notifyError` toasts (popup/options/welcome) or `OverlayNotice` (in-page overlays). Do not render red error paragraphs below forms except for field-local input validation.
- **Graceful degradation**: Version skew between popup/options and background or a failed optional request must degrade cleanly rather than telling the user to reload the extension.
- **No persisted inferred state**: Never persist assumptions inferred from user data (such as "this site only uses passkeys"). Query vaults live or keep ephemeral state in memory / `storage.session`.
- **Passkey coexistence with Apple Passwords**: Apple's native helper protocol has no passkey commands; macOS Passwords passkeys flow through native WebAuthn. Pure Apple Passwords users (no Bitwarden accounts configured) must pass straight through to native `navigator.credentials.create/get`, and Bitwarden users must always have a one-click native/system passkey fallback.
- **Explicit exclusions**: Do not auto-copy TOTP after filling credentials; do not autofill on page load without user interaction.
- **Licensing**: This repository is MIT. Never copy GPL-3.0 code from `bitwarden/clients` (ideas and domain rules only, implemented cleanly from scratch). Attribution for Apache-2.0 resources belongs in `scripts/third-party-notices.ts`.

import { createRequire } from "node:module"
import type { PureCrypto } from "@bitwarden/sdk-internal"
import { pureCryptoAdapter } from "./crypto"

/** The SDK's Node build, for tests; it runs the same WebAssembly as the extension. */
export const sdk = createRequire(import.meta.url)(
  "@bitwarden/sdk-internal/node/bitwarden_wasm_internal.js",
).PureCrypto as typeof PureCrypto

export const testVaultCrypto = pureCryptoAdapter(sdk)

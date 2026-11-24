import * as sdk from "@bitwarden/sdk-internal"
import { pureCryptoAdapter, type VaultCrypto } from "./crypto"

/** Copied into the build by the hook in wxt.config.ts. */
const WASM_PATH = "/bitwarden_wasm_internal_bg.wasm"

let loading: Promise<VaultCrypto> | null = null

/**
 * Instantiates the SDK's WebAssembly module once per service worker. Only the background imports
 * this file, so extension pages and content scripts do not carry the module. The module imports
 * its JavaScript glue under the name below, which the package's entry re-exports.
 */
export function loadVaultCrypto(): Promise<VaultCrypto> {
  loading ??= (async () => {
    const imports = {
      "./bitwarden_wasm_internal_bg.js":
        sdk as unknown as WebAssembly.ModuleImports,
    }
    // Resolved against the service worker's own extension URL.
    const { instance } = await WebAssembly.instantiateStreaming(
      fetch(WASM_PATH),
      imports,
    )
    sdk.init(instance.exports)
    return pureCryptoAdapter(sdk.PureCrypto)
  })()
  loading.catch(() => {
    loading = null
  })
  return loading
}

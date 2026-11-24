import "@bitwarden/sdk-internal"

declare module "@bitwarden/sdk-internal" {
  /** Sets the instantiated WebAssembly exports. Defined in the package's index.js but missing from its types. */
  export function init(wasmExports: WebAssembly.Exports): void
}

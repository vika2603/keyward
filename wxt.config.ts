import { createRequire } from "node:module"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "wxt"

const require = createRequire(import.meta.url)

export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-react"],
  // A function so it runs after WXT has loaded the .env files.
  manifest: () => ({
    name: "Keyward",
    description:
      "Fills, generates and saves passwords with Apple Passwords and Bitwarden.",
    permissions: [
      // The browser's favicon cache, for login icons without asking another server.
      "favicon",
      "nativeMessaging",
      "storage",
      "webNavigation",
      "alarms",
      "offscreen",
      "clipboardWrite",
      "scripting",
    ],
    // The field icons work on every site, and a self-hosted vault can live at any address.
    host_permissions: ["http://*/*", "https://*/*"],
    content_security_policy: {
      // The Bitwarden SDK is WebAssembly.
      extension_pages:
        "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    web_accessible_resources: [
      {
        resources: ["inline-menu.html", "save-prompt.html"],
        matches: ["http://*/*", "https://*/*"],
      },
    ],
    commands: {
      _execute_action: {
        suggested_key: { default: "Ctrl+Shift+L", mac: "MacCtrl+Shift+L" },
      },
      "fill-first": {
        suggested_key: { default: "Ctrl+Shift+U", mac: "MacCtrl+Shift+U" },
        description: "Fill the first login for the current site",
      },
      "open-generator": {
        suggested_key: { default: "Ctrl+Shift+G", mac: "MacCtrl+Shift+G" },
        description: "Open the generator",
      },
      "lock-all": {
        description: "Lock all backends",
      },
    },
    // Apple's native messaging host only accepts its own extension IDs. With the public key of Apple's
    // extension this build gets the same ID; it is kept out of the repository in .env.local.
    ...(process.env.KEYWARD_MANIFEST_KEY
      ? { key: process.env.KEYWARD_MANIFEST_KEY }
      : {}),
  }),
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  hooks: {
    // The Bitwarden SDK's WebAssembly ships as a file of its own; imported, it would be inlined as base64.
    "build:publicAssets": (_wxt, files) => {
      files.push({
        absoluteSrc: require.resolve(
          "@bitwarden/sdk-internal/bitwarden_wasm_internal_bg.wasm",
        ),
        relativeDest: "bitwarden_wasm_internal_bg.wasm",
      })
    },
  },
})

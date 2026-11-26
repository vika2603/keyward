import { createRequire } from "node:module"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "wxt"
import { LICENSE_LISTS, writeNotices } from "./scripts/third-party-notices"

const require = createRequire(import.meta.url)

// `pnpm zip` packages Keyward for the Chrome Web Store. The package carries no manifest key, as the
// store keeps the key itself, and is built in a folder of its own, apart from the unpacked build a
// browser may have loaded.
const forStore = process.env.KEYWARD_STORE === "1"

export default defineConfig({
  srcDir: "src",
  ...(forStore && {
    outDirTemplate: "{{browser}}-mv{{manifestVersion}}-store",
  }),
  modules: ["@wxt-dev/module-react"],
  // A function so it runs after WXT has loaded the .env files.
  manifest: () => ({
    name: "__MSG_extName__",
    description: "__MSG_extDescription__",
    default_locale: "en",
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
      // Turns off the browser's own offer to save passwords while Keyward offers instead.
      "privacy",
      // "Set up verification code" on QR codes and links that carry an authenticator key.
      "contextMenus",
      // Locks Bitwarden accounts when the screen locks.
      "idle",
      // Signs in to sites that ask through the browser's own sign-in dialog, with the login the
      // user chooses.
      "webRequest",
      "webRequestAuthProvider",
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
        description: "__MSG_commandFillFirst__",
      },
      "open-generator": {
        suggested_key: { default: "Ctrl+Shift+G", mac: "MacCtrl+Shift+G" },
        description: "__MSG_commandOpenGenerator__",
      },
      "lock-all": {
        description: "__MSG_commandLockAll__",
      },
    },
    // A public key gives the build one extension ID wherever it is loaded from, so the host manifest
    // that the Passwords setup command writes for that ID keeps applying. It stays in .env.local.
    ...(!forStore && process.env.KEYWARD_MANIFEST_KEY
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
    // The store package names the licenses of what it bundles. WXT builds the extension in several
    // Vite builds, so each writes a list of its own and the lists are joined once all are done.
    "vite:build:extendConfig": (entrypoints, viteConfig) => {
      if (!forStore) return
      viteConfig.build = {
        ...viteConfig.build,
        license: {
          fileName: `${LICENSE_LISTS}/${entrypoints.map((entrypoint) => entrypoint.name).join("+")}.json`,
        },
      }
    },
    "build:done": async (wxt) => {
      if (forStore) await writeNotices(wxt.config.outDir)
    },
  },
})

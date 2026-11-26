# Keyward

A Chrome extension that fills, generates and saves passwords from two kinds of vaults:

- **Passwords**, the macOS Passwords app, through the helper that ships with macOS.
- **Bitwarden**, on bitwarden.com or a self-hosted server. Several accounts can be signed in at once.

## Features

- An icon in login fields opens a menu of the site's logins; a login is sent to the page only after you pick it.
- A site's logins include those of sites that share its accounts: the equivalent domains set in the settings, and the sites Apple's password-manager-resources lists, such as alibaba.com and aliexpress.com.
- One-time codes (TOTP), filled into code fields or copied.
- Takes over the page's conditional passkey requests on sites where you signed in with a passkey; can be turned off in settings.
- Offers to save or update a login after you sign in.
- On sign-up and change-password forms, offers a generated password that keeps to the field's length limits and `passwordrules` attribute, or to the rules Apple's [password-manager-resources](https://github.com/apple/password-manager-resources) lists for the site.
- Generator for passwords, passphrases and usernames, with a history of generated passwords that ends with the browser session.
- Popup with search across all vaults, login details, and for Bitwarden: a list of every item on its tab, secure notes, editing, deleting, custom fields and password history.
- Keyboard shortcuts: open the popup (Ctrl+Shift+L), fill the first login (Ctrl+Shift+U), open the generator (Ctrl+Shift+G).
- English and Chinese interface.

## Requirements

- [mise](https://mise.jdx.dev), which installs the Node and pnpm versions in `mise.toml` and runs the development tasks.
- For Passwords: macOS 14 or later, which comes with the Passwords helper, and the one-time step below on each Mac.

## Setup

```sh
mise install     # Node and pnpm
mise run setup   # dependencies
```

A browser starts the Passwords helper only for the extensions that a host manifest names. Connect in the Vaults settings opens Keyward's Connect Passwords page while this Mac lacks that step; the page shows a Terminal command with the extension's ID. The command downloads `scripts/setup.sh` from this repository's `main` branch and runs it; the script writes `keyward.passwords.json`, which names that ID and points at the system helper, into the `NativeMessagingHosts` folder of each Chromium browser that has the extension installed: the browser's usual data folder under `~/Library/Application Support`, or the folder that a running browser was started with through `--user-data-dir`. It needs no administrator password. From a checkout:

```sh
scripts/setup.sh <extension ID>
scripts/setup.sh --user-data-dir <folder> <extension ID>  # that folder only, without looking for the extension
scripts/setup.sh --uninstall
```

An unpacked build gets its ID from the folder it is loaded from, so the command has to run again after the folder moves. To keep one ID, create `.env.local` with a public key, which the build adds to the manifest as `key`:

```sh
KEYWARD_MANIFEST_KEY=<public key>
```

## Build and load

```sh
mise run build
```

In `chrome://extensions`, turn on Developer mode, choose "Load unpacked" and select `.output/chrome-mv3`. After a rebuild, click the extension's reload button.

## Checks

```sh
mise run check   # lint, type check and tests together
mise run format  # fix formatting
```

`mise tasks` lists every task; each one runs the matching `pnpm` script.

## Project layout

- `src/entrypoints/`: popup, options page, background, content scripts, and the in-page menu and save prompt.
- `src/lib/providers/`: one provider per vault type (`apple`, `bitwarden`) behind a common interface in `types.ts`.
- `src/background/`: message handlers, filling and the checks that run before a secret is sent to a page.
- `src/content/`: finding login and code fields in pages.

## Security

- Decrypted secrets and session keys stay in memory or in `storage.session`. `storage.local` holds settings and, for each Bitwarden account, a user key and refresh token that are encrypted and useless without the master password.
- Before a login or code is sent to a frame, the background checks that the frame's origin matches the login, and the content script fills only if its origin is still the one checked.

## License

Keyward's own code is under the MIT License; see [LICENSE](LICENSE).

The built extension also contains `@bitwarden/sdk-internal`, which is under GPL-3.0, and data from Apple's password-manager-resources in `src/lib/site-data`, which is under the MIT License; see [its license](src/lib/site-data/LICENSE.apple.md). `mise run site-data` updates that data.

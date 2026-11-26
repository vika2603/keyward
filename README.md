# Keyward

A Chrome extension that fills, generates and saves passwords from two kinds of vaults:

- **Passwords**, the macOS Passwords app, through the helper that ships with macOS.
- **Bitwarden**, on bitwarden.com or a self-hosted server. Several accounts can be signed in at once.

## Features

- An icon in login fields opens a menu of the site's logins; a login is sent to the page only after you pick it.
- One-time codes (TOTP), filled into code fields or copied.
- Takes over the page's conditional passkey requests on sites where you signed in with a passkey; can be turned off in settings.
- Offers to save or update a login after you sign in.
- Generator for passwords, passphrases and usernames, with a history of generated passwords that ends with the browser session.
- Popup with search across all vaults, login details, and for Bitwarden: a list of every item on its tab, secure notes, editing, deleting, custom fields and password history.
- Keyboard shortcuts: open the popup (Ctrl+Shift+L), fill the first login (Ctrl+Shift+U), open the generator (Ctrl+Shift+G).
- English and Chinese interface.

## Requirements

- [mise](https://mise.jdx.dev), which installs the Node and pnpm versions in `mise.toml` and runs the development tasks.
- For Passwords: macOS with the Passwords app. The system helper only accepts the extension ID of Apple's iCloud Passwords extension, so the build needs that extension's public key (see below).

## Setup

```sh
mise install     # Node and pnpm
mise run setup   # dependencies
```

To use Passwords, create `.env.local` with the `key` value from the `manifest.json` of the iCloud Passwords extension:

```sh
KEYWARD_MANIFEST_KEY=<public key>
```

The built extension then has the same ID as iCloud Passwords, so the two cannot be installed in the same Chrome profile. Without the key, the Bitwarden part still works.

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

The built extension also contains `@bitwarden/sdk-internal`, which is under GPL-3.0. Whoever distributes the built extension, the SDK included, does so under the terms of GPL-3.0; the source for it is this repository.

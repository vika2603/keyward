# Keyward privacy policy

Effective 26 November 2026.

Keyward is a browser extension that fills, generates and saves passwords with the vaults you connect to it: the Passwords app on your Mac and Bitwarden accounts. Keyward's developer runs no server. Keyward sends nothing to the developer, contains no analytics or advertising, and does not sell or share your data.

## Your vaults

Keyward reads logins, verification codes and secure notes from the vaults you connect, and writes to them only when you save, edit or delete an item.

- **Passwords.** Keyward exchanges data with the Passwords helper that comes with macOS, on your Mac, through the browser's native messaging. It sends none of this data over the network.
- **Bitwarden.** Keyward signs in to the server you choose (bitwarden.com, bitwarden.eu or a self-hosted server) with your email address and master password. It downloads your encrypted vault and decrypts it on your device; items you save or change are encrypted on your device before they are sent to that server. The server's handling of your data is governed by Bitwarden's privacy policy or, for a self-hosted server, by its operator.

## Web pages

To find sign-in and sign-up forms and to offer the matching logins, Keyward reads the address of the page you are on and the fields of its forms. It fills a login only after you choose one, and only into a page whose site the login belongs to. When you submit a form, Keyward reads the username and password you entered so that it can offer to save them, and keeps them in session storage only for that offer. When you choose "Set up verification code" on a QR code or link, Keyward reads that code or link to add a verification code to a login. When a site asks for a login through the browser's own sign-in dialog, Keyward reads the site's address to list its logins, and sends the login you choose to that site only. Site icons come from the browser's own icon cache.

## Data kept in the browser

Keyward keeps the following in the browser's extension storage on your device:

- Your settings, including any per-site rules you add.
- For each Bitwarden account: the email address, the server address, the name you gave it, the encrypted vault sync payload (for offline unlock), and the account key and sign-in token in encrypted form, which can be used only with your master password. Also a random device identifier that Bitwarden servers require.
- Your generator options, including any email forwarding service API key you enter if you enable forwarded email aliases.

Unlocked keys, access tokens, the Passwords session, popup view cache and the generator history are kept only in memory or in session storage, which the browser clears when it closes.

## Optional external requests you trigger

Keyward never contacts third-party services in the background. It sends a request outside your configured password vault only when you explicitly click to use one of these optional features:

- **Forwarded email aliases.** When you configure an API key and click to generate a forwarded email alias, Keyward sends an alias-creation request directly to the service you selected (SimpleLogin, Addy.io, Fastmail Masked Email, Firefox Relay, DuckDuckGo Email Protection, or ForwardEmail), including the active site's hostname as a note when available.
- **On-demand password breach check.** When you click to check a password for known breaches, Keyward hashes the password locally with SHA-1 and sends only the first 5 hexadecimal characters of the hash to `api.pwnedpasswords.com` (with `Add-Padding: true`) using k-anonymity. Your password and full hash never leave your device. Password strength scoring (`zxcvbn`) runs entirely locally.

## Browser settings and the clipboard

While Keyward offers to save passwords, it turns off the browser's own offer, so that a submitted form brings up one prompt rather than two; you can give the setting back to the browser in Keyward's settings. When you copy a password, code or other secret, Keyward overwrites the clipboard after the time set in its settings, 30 seconds by default.

## Removing your data

Signing out of a Bitwarden account in Keyward's settings removes what Keyward keeps for it. Removing the extension makes the browser delete all of Keyward's storage. The file that the Passwords setup command writes, which lets the browser start the Passwords helper for Keyward, can be removed with the removal command in Keyward's settings.

## Changes and contact

Changes to this policy are published in this file at https://raw.githubusercontent.com/vika2603/keyward/main/PRIVACY.md. Questions can be asked at https://github.com/vika2603/keyward/issues.

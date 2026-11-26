# Chrome Web Store listing

The text to enter in the Chrome Developer Dashboard for Keyward. The name and the summary come from the package's `_locales`; the images are in this folder.

## Store listing

- **Category:** Privacy & Security
- **Language:** English, with a Chinese (Simplified) listing added
- **Homepage URL:** https://github.com/vika2603/keyward
- **Support URL:** https://github.com/vika2603/keyward/issues
- **Screenshots:** `en/screenshot-*.png` for the English listing and `zh_CN/screenshot-*.png` for the Chinese one, 1280×800, in the order of their numbers
- **Small promo tile:** `promo-small.png`, 440×280

### Description (English)

```text
Keyward fills, generates and saves passwords with the vaults you already use: the Passwords app on your Mac and Bitwarden.

Fill
• Sign-in fields show the Keyward icon and a menu of the logins saved for the site. Choose one to fill it.
• Fills verification codes, and offers passkey sign-in in the same menu on sites that support it.
• When a site, such as a router's admin page, asks for a login in the browser's own sign-in dialog, Keyward's popup lists the site's logins first.
• A keyboard shortcut fills a login for the current site; press it again for the next one.

Save
• Offers to save a new login, or to update a changed password, after you submit a form.
• Suggests a strong password in sign-up and change-password forms.

Generate
• Passwords, passphrases and usernames, with a history of what you generated in this session.

Your vaults
• Passwords (macOS 14 or later): run the one-time setup command that Keyward shows, then enter the code your Mac displays. Keyward talks to the Passwords helper that comes with macOS, and nothing goes over the network.
• Bitwarden: sign in to bitwarden.com, bitwarden.eu or a self-hosted server. Several accounts can be unlocked at once, and your vault is decrypted on your device.

Privacy
Keyward has no server of its own, no analytics and no ads. It fills a login only after you choose it, and only on the site the login belongs to. The source code is public at https://github.com/vika2603/keyward.

Keyward is an independent project, not affiliated with Apple or Bitwarden.
```

### Description (Chinese)

```text
Keyward 用你已经在用的密码库填充、生成和保存密码：Mac 上的 Passwords App，以及 Bitwarden。

填充
• 登录框里显示 Keyward 图标和本站已保存登录的菜单，选中一个即可填入。
• 填充验证码；网站支持通行密钥时，同一个菜单里也能用通行密钥登录。
• 网站（如路由器管理页）用浏览器自带的登录对话框要求登录时，Keyward 弹窗会先列出这个网站的登录。
• 用快捷键填充当前网站的登录，再按一次换下一个。

保存
• 提交表单后，提示保存新的登录，或更新改过的密码。
• 在注册和修改密码的表单里建议强密码。

生成
• 生成密码、密码短语和用户名，并保留本次浏览器会话的生成记录。

密码库
• Passwords（macOS 14 及以上）：运行一次 Keyward 显示的设置命令，再输入 Mac 上显示的验证码。Keyward 与 macOS 自带的 Passwords 助手通信，数据不经过网络。
• Bitwarden：登录 bitwarden.com、bitwarden.eu 或自建服务器。可以同时解锁多个账号，密码库在你的设备上解密。

隐私
Keyward 没有自己的服务器，不做统计，没有广告。只有你选中一个登录后才会填充，而且只填到它所属的网站。源码公开在 https://github.com/vika2603/keyward。

Keyward 是独立项目，与 Apple 和 Bitwarden 没有关联。
```

## Privacy practices

### Single purpose

```text
Keyward fills, generates and saves passwords on web pages, using the password vaults the user connects to it: the Passwords app on macOS and Bitwarden.
```

### Permission justifications

| Permission | Justification |
| --- | --- |
| Host permissions (`http://*/*`, `https://*/*`) | Keyward finds sign-in, sign-up and verification-code fields on the sites the user visits, shows its icon and menu in them, fills the login the user chooses and offers to save the login the user submits. Users sign in on any site, and a self-hosted Bitwarden server can be at any address. |
| `nativeMessaging` | Reads and saves logins in the macOS Passwords app through the Passwords helper that comes with macOS. |
| `storage` | Keeps the settings and the Bitwarden account details, with the account key encrypted, and keeps unlocked state in session storage only. |
| `webNavigation` | Looks up the address of the frame that asks for a login, so that a login is filled only into a frame of the site it belongs to. |
| `scripting` | Adds Keyward's content script to the tabs that are already open when Keyward is installed or updated, so they work without a reload. |
| `contextMenus` | Right-click menus that fill or copy a login of the current site, generate a password, and set up a verification code from a QR code or `otpauth://` link. |
| `clipboardWrite` | Copies a username, password or verification code when the user asks. |
| `offscreen` | Writes to the clipboard from the background service worker, which has no clipboard, to copy secrets and to clear them after the time set by the user. |
| `alarms` | Clears a copied secret from the clipboard after the time set by the user, and locks Bitwarden accounts that have not been used for the time set by the user. |
| `idle` | Locks Bitwarden accounts when the computer locks. |
| `privacy` | Turns off the browser's own offer to save passwords while Keyward offers instead, so that a submitted form brings up one prompt. Users can give the setting back to the browser in Keyward's settings. |
| `favicon` | Shows site icons from the browser's own icon cache, without requesting another server. |
| `webRequest` | Notices when a site the user opens asks for a login through the browser's own sign-in dialog, as router and other admin pages do, so that Keyward can list the site's logins first. Keyward reads no other request. |
| `webRequestAuthProvider` | Answers that sign-in request with the login the user chooses in Keyward's popup, or leaves it to the browser's dialog. |

### Remote code

No, I am not using remote code. The Bitwarden SDK's WebAssembly module is included in the package.

### Data usage

Check these types of data:

- Personally identifiable information: the email address of a Bitwarden account.
- Authentication information: the logins in the user's vaults, and a login the user submits.
- Website content: the form fields of a page, and a QR code the user chooses.

Check all three certifications. The data is used only to fill, generate and save passwords, and goes nowhere but the vault the user connects.

### Privacy policy URL

```text
https://raw.githubusercontent.com/vika2603/keyward/main/PRIVACY.md
```

## Test instructions

```text
Passwords needs macOS 14 or later and a setup command run in Terminal, so Bitwarden is the easier vault to test:
1. Create a free account at https://vault.bitwarden.com and add a login for https://github.com.
2. Open Keyward's popup, choose Bitwarden, and sign in with that account.
3. Open https://github.com/login. Click the Keyward icon in the username field and choose the login to fill it.
4. The generator is in the popup; settings are in Keyward's options page.
```

export const en = {
  "options.nav.label": "Settings sections",
  "options.nav.heading": "Settings",

  "options.duration.seconds": "{count} seconds",
  "options.duration.oneMinute": "1 minute",
  "options.duration.minutes": "{count} minutes",
  "options.duration.oneHour": "1 hour",
  "options.duration.hours": "{count} hours",

  "options.backends.title": "Vaults",
  "options.backends.description":
    "Items in the popup and the in-page menu come from the vaults connected here.",
  "options.backends.apple.description":
    "The connection isn't kept for long. When needed, enter the six-digit code shown on your Mac in the popup.",
  "options.backends.apple.toggle": "Use Passwords",
  "options.backends.apple.actions.name": "Available actions",
  "options.backends.apple.actions.description":
    "List accounts for the current site, fill, copy passwords and save new ones. Other management is done in the Passwords app.",
  "options.backends.apple.openApp": "Open Passwords app",
  "options.backends.bitwarden.signedInDescription":
    "You can sign in to several accounts at once, and their items are shown together. When locked, unlock each account with its master password in the popup.",
  "options.backends.bitwarden.signedOutDescription":
    "Not signed in. Works with the official service and self-hosted servers, and you can sign in to several accounts at once.",
  "options.backends.bitwarden.addAccount": "Add account",
  "options.backends.bitwarden.signIn": "Sign in",
  "options.backends.bitwarden.officialServer": "Official service",
  "options.backends.bitwarden.signOut": "Sign out",
  "options.backends.bitwarden.signOutConfirm":
    "Sign out of {email}? You'll need your master password and two-step login code to sign in again.",
  "options.backends.autoLock.name": "Auto-lock",
  "options.backends.autoLock.description":
    "Lock when the extension hasn't been used for this long; you'll then need your master password again. You also need to unlock again after quitting the browser.",
  "options.backends.autoLock.label": "Auto-lock timeout",
  "options.backends.autoLock.onQuit": "When the browser quits",
  "options.backends.lockOnSystemLock.name": "Lock with the computer",
  "options.backends.lockOnSystemLock.description":
    "Lock Bitwarden accounts when the computer's screen locks. Passwords stays paired; it asks for Touch ID before each password anyway.",
  "options.backends.saveTarget.title": "Save location",
  "options.backends.saveTarget.name": "Save new logins to",
  "options.backends.saveTarget.description":
    "You can still choose another location in the save prompt.",

  "options.fill.title": "Fill and save",
  "options.fill.description":
    "Applies to all sites. You can override it per site in site rules.",
  "options.fill.menu.title": "In-page menu",
  "options.fill.menuTrigger.name": "When to show the menu",
  "options.fill.menuTrigger.description":
    "The icon appears in the fields of login and sign-up forms. If you choose On icon click, the menu won't pop up by itself and cover the page.",
  "options.fill.menuTrigger.click": "On icon click",
  "options.fill.menuTrigger.focus": "On field focus",
  "options.fill.crossOriginFrames.name": "Show in cross-origin frames",
  "options.fill.crossOriginFrames.description":
    "Also offer suggestions when a login form is embedded in a frame from another domain.",
  "options.fill.takeOverPasskeys.name": "Offer passkeys in the menu",
  "options.fill.takeOverPasskeys.description":
    "On sites where you have signed in with a passkey in this browser, Chrome's passkey list under the field is replaced by \"Sign in with a passkey\" in the menu, which opens Chrome's passkey dialog. Other sites keep Chrome's list, which appears only when you have a passkey there.",
  "options.fill.autofill.title": "Autofill",
  "options.fill.autoSubmit.name": "Submit after filling",
  "options.fill.autoSubmit.description":
    "Submit the login form after filling in the username and password. Works only with regular forms that have a submit button.",
  "options.fill.save.title": "Saving",
  "options.fill.askSave.name": "Ask to save new logins",
  "options.fill.askSave.description":
    "Show a save prompt after a login or sign-up form is submitted. Submissions on some sites may not be detected.",
  "options.fill.askUpdate.name": "Ask to update changed passwords",
  "options.fill.askUpdate.description":
    "Show an update prompt when the submitted password differs from the saved one.",
  "options.fill.takeOverSaving.name": "Take over the browser's password saving",
  "options.fill.takeOverSaving.description":
    "Turn off the browser's own offer to save passwords, so only Keyward asks. The browser's settings show that Keyward controls this.",
  "options.fill.takeOverSaving.otherExtension":
    "Another extension, such as iCloud Passwords, controls this setting, so it has no effect. Turn that extension off for Keyward to take over.",
  "options.fill.takeOverSaving.policy":
    "This browser does not let extensions change this setting.",
  "options.fill.clipboard.title": "Clipboard",
  "options.fill.clipboardClear.name": "Clear clipboard automatically",
  "options.fill.clipboardClear.description":
    "After you copy a password, the clipboard is overwritten with empty content once this time has passed. History kept by the system or clipboard tools isn't affected.",
  "options.fill.clipboardClear.label": "Time before clearing the clipboard",
  "options.fill.clipboardClear.never": "Never",

  "options.sites.title": "Site rules",
  "options.sites.description":
    "Decide how items match web addresses, and override the default behavior per site.",
  "options.sites.match.domain": "Base domain",
  "options.sites.match.host": "Host",
  "options.sites.match.startsWith": "Starts with",
  "options.sites.match.exact": "Exact",
  "options.sites.match.regularExpression": "Regular expression",
  "options.sites.match.never": "Never",
  "options.sites.match.default": "Default",
  "options.sites.match.defaultWith": "Default ({match})",
  "options.sites.match.bySystem": "Decided by the system",
  "options.sites.backend.all": "All",
  "options.sites.behavior.default": "Default",
  "options.sites.behavior.menuOnClick": "Show menu on icon click",
  "options.sites.behavior.menuOnFocus": "Show menu on field focus",
  "options.sites.behavior.noSave": "Don't ask to save",
  "options.sites.behavior.disabled": "Don't fill or ask to save",
  "options.sites.defaultMatch.name": "Default match detection",
  "options.sites.defaultMatch.description":
    "Applies to Bitwarden items. Matching for Passwords is decided by the system.",
  "options.sites.rules.title": "Per-site overrides",
  "options.sites.rules.add": "Add rule",
  "options.sites.rules.site": "Website",
  "options.sites.rules.match": "Match detection",
  "options.sites.rules.backend": "Vault",
  "options.sites.rules.behavior": "Behavior",
  "options.sites.rules.actions": "Actions",
  "options.sites.rules.delete": "Delete rule for {host}",
  "options.sites.rules.empty": "No rules yet.",
  "options.sites.ruleDialog.description":
    "The rule applies to this host and its subdomains.",
  "options.sites.domains.title": "Equivalent domains",
  "options.sites.domains.add": "Add group",
  "options.sites.domains.separator": ", ",
  "options.sites.domains.description":
    "Domains in the same group share items. Passwords isn't affected.",
  "options.sites.domains.delete": "Delete this group of equivalent domains",
  "options.sites.domains.empty":
    "No equivalent domains yet. Domains in the same group share Bitwarden items; Passwords isn't affected.",
  "options.sites.domainDialog.title": "Add equivalent domains",
  "options.sites.domainDialog.description":
    "Enter two or more domains, separated by commas or spaces.",
  "options.sites.domainDialog.input": "Domains",
  "options.sites.dialog.cancel": "Cancel",
  "options.sites.dialog.add": "Add",

  "options.keys.title": "Shortcuts and appearance",
  "options.keys.shortcuts.title": "Keyboard shortcuts",
  "options.keys.shortcuts.change": "Change in browser",
  "options.keys.shortcuts.description":
    "Keyboard shortcuts are managed by the browser. The keys currently in effect are shown here.",
  "options.keys.shortcuts.notSet": "Not set",
  "options.keys.command.openPopup": "Open popup",
  "options.keys.command.fillFirst": "Fill the first match for the current site",
  "options.keys.command.openGenerator": "Open generator",
  "options.keys.command.lockAll": "Lock all vaults",
  "options.keys.appearance.title": "Appearance",
  "options.keys.theme.name": "Theme",
  "options.keys.theme.system": "Follow system",
  "options.keys.theme.light": "Light",
  "options.keys.theme.dark": "Dark",
  "options.keys.density.name": "List density",
  "options.keys.density.description":
    "In compact mode, the account name and the site (for Bitwarden, the item name) share one line, so more items fit on screen.",
  "options.keys.density.standard": "Standard",
  "options.keys.density.compact": "Compact",
  "options.keys.language.name": "Language",
  "options.keys.language.system": "Follow browser",
  "options.keys.language.zhCN": "简体中文",
  "options.keys.language.en": "English",
  "options.keys.file.title": "Settings file",
  "options.keys.export.name": "Export settings",
  "options.keys.export.description":
    "Export site rules and fill options as a JSON file. No passwords are included.",
  "options.keys.export.button": "Export",
  "options.keys.import.name": "Import settings",
  "options.keys.import.description":
    "Importing replaces the current site rules and fill options.",
  "options.keys.import.button": "Choose file",
  "options.keys.import.done": "Imported.",
  "options.keys.import.failed":
    "Couldn't import: the file isn't a Keyward settings export.",

  "options.onboard.title": "Sign in to Bitwarden",
  "options.onboard.description":
    "After signing in, the account is unlocked with its master password.",
  "options.onboard.later": "Back",
  "options.onboard.method.authenticator": "Authenticator app",
  "options.onboard.method.authenticatorHint":
    "Enter the code shown in your authenticator app.",
  "options.onboard.method.email": "Email",
  "options.onboard.method.emailHint":
    "A code has been sent to your account email.",
  "options.onboard.method.recoveryCode": "Recovery code",
  "options.onboard.method.recoveryCodeHint":
    "Enter the recovery code you saved when you turned on two-step login.",
  "options.onboard.method.newDevice": "New device verification",
  "options.onboard.method.newDeviceHint":
    "The server has sent a code to your account email to confirm this new device.",
  "options.onboard.secondStep.method": "Verification method",
  "options.onboard.secondStep.code": "Code",
  "options.onboard.secondStep.submit": "Verify and sign in",
  "options.onboard.secondStep.back": "Back",
  "options.onboard.signIn.server": "Server",
  "options.onboard.signIn.official": "Official (bitwarden.com)",
  "options.onboard.signIn.selfHosted": "Self-hosted",
  "options.onboard.signIn.serverUrl": "Server URL",
  "options.onboard.signIn.email": "Email",
  "options.onboard.signIn.masterPassword": "Master password",
  "options.onboard.signIn.submit": "Sign in",
  "options.onboard.signIn.busy": "Signing in…",
} as const

export const zhCN: Record<keyof typeof en, string> = {
  "options.nav.label": "设置分区",
  "options.nav.heading": "设置",

  "options.duration.seconds": "{count} 秒",
  "options.duration.oneMinute": "1 分钟",
  "options.duration.minutes": "{count} 分钟",
  "options.duration.oneHour": "1 小时",
  "options.duration.hours": "{count} 小时",

  "options.backends.title": "密码库",
  "options.backends.description":
    "弹窗和页面内菜单里的条目来自这里连接的密码库。",
  "options.backends.apple.description":
    "连接不会长期保留，需要时在弹窗里输入 Mac 上显示的六位验证码。",
  "options.backends.apple.toggle": "使用 Passwords",
  "options.backends.apple.actions.name": "可用操作",
  "options.backends.apple.actions.description":
    "按当前站点列出账号、填充、复制密码和保存新密码。其余管理操作在 Passwords App 中完成。",
  "options.backends.apple.openApp": "打开 Passwords App",
  "options.backends.bitwarden.signedInDescription":
    "可以同时登录多个账号，条目一起显示。锁定后在弹窗里逐个输入主密码解锁。",
  "options.backends.bitwarden.signedOutDescription":
    "尚未登录。支持官方服务和自建服务器，可以同时登录多个账号。",
  "options.backends.bitwarden.addAccount": "添加账号",
  "options.backends.bitwarden.signIn": "登录",
  "options.backends.bitwarden.officialServer": "官方服务",
  "options.backends.bitwarden.signOut": "退出登录",
  "options.backends.bitwarden.signOutConfirm":
    "退出 {email}？之后需要重新输入主密码和两步验证码登录。",
  "options.backends.autoLock.name": "自动锁定",
  "options.backends.autoLock.description":
    "超过这段时间没有使用插件就锁定，之后需要再次输入主密码。退出浏览器后也要重新解锁。",
  "options.backends.autoLock.label": "自动锁定时间",
  "options.backends.autoLock.onQuit": "退出浏览器时",
  "options.backends.lockOnSystemLock.name": "电脑锁屏时锁定",
  "options.backends.lockOnSystemLock.description":
    "电脑锁屏时锁定 Bitwarden 账号。 Passwords 保持配对，它每次取密码都会要求触控 ID。",
  "options.backends.saveTarget.title": "保存位置",
  "options.backends.saveTarget.name": "新登录默认保存到",
  "options.backends.saveTarget.description": "保存提示里仍可临时改选。",

  "options.fill.title": "填充与保存",
  "options.fill.description": "对所有站点生效，可在站点规则里按站点覆盖。",
  "options.fill.menu.title": "页面内菜单",
  "options.fill.menuTrigger.name": "何时显示候选菜单",
  "options.fill.menuTrigger.description":
    "图标显示在登录和注册表单的输入框里。选择点击图标时，菜单不会自动弹出遮挡页面。",
  "options.fill.menuTrigger.click": "点击图标时",
  "options.fill.menuTrigger.focus": "输入框获得焦点时",
  "options.fill.crossOriginFrames.name": "在跨域框架中显示",
  "options.fill.crossOriginFrames.description":
    "登录框嵌在其他域名的框架里时也提供候选。",
  "options.fill.takeOverPasskeys.name": "在菜单里提供通行密钥",
  "options.fill.takeOverPasskeys.description":
    "在这个浏览器里用通行密钥登录过的网站，Chrome 不再在输入框下列出通行密钥，改为在菜单里点「使用通行密钥登录」，再由 Chrome 的通行密钥窗口验证。其他网站仍用 Chrome 的列表，它只在你有通行密钥时出现。",
  "options.fill.autofill.title": "自动填充",
  "options.fill.autoSubmit.name": "填充后自动提交",
  "options.fill.autoSubmit.description":
    "填入用户名和密码后提交登录表单。只对有提交按钮的普通表单有效。",
  "options.fill.save.title": "保存",
  "options.fill.askSave.name": "询问保存新登录",
  "options.fill.askSave.description":
    "检测到登录或注册表单提交后显示保存提示，个别站点可能检测不到。",
  "options.fill.askUpdate.name": "询问更新已变更的密码",
  "options.fill.askUpdate.description":
    "提交的密码与已保存的不一致时显示更新提示。",
  "options.fill.takeOverSaving.name": "接管浏览器的密码保存",
  "options.fill.takeOverSaving.description":
    "关闭浏览器自带的「提示保存密码」，只由 Keyward 询问。浏览器设置里会显示这项由 Keyward 控制。",
  "options.fill.takeOverSaving.otherExtension":
    "另一个插件（例如 Passwords）正在控制这项设置，所以这里暂时不生效。停用那个插件后 Keyward 才能接管。",
  "options.fill.takeOverSaving.policy": "这个浏览器不允许插件修改这项设置。",
  "options.fill.clipboard.title": "剪贴板",
  "options.fill.clipboardClear.name": "自动覆盖剪贴板",
  "options.fill.clipboardClear.description":
    "复制密码后，经过这段时间用空内容覆盖剪贴板。系统或剪贴板工具留存的历史不受影响。",
  "options.fill.clipboardClear.label": "覆盖剪贴板前的等待时间",
  "options.fill.clipboardClear.never": "从不",

  "options.sites.title": "站点规则",
  "options.sites.description": "决定条目与网址如何匹配，并按站点覆盖默认行为。",
  "options.sites.match.domain": "主域名",
  "options.sites.match.host": "主机名",
  "options.sites.match.startsWith": "开头一致",
  "options.sites.match.exact": "完全一致",
  "options.sites.match.regularExpression": "正则表达式",
  "options.sites.match.never": "从不匹配",
  "options.sites.match.default": "默认",
  "options.sites.match.defaultWith": "默认（{match}）",
  "options.sites.match.bySystem": "由系统决定",
  "options.sites.backend.all": "全部",
  "options.sites.behavior.default": "默认",
  "options.sites.behavior.menuOnClick": "点击图标时显示菜单",
  "options.sites.behavior.menuOnFocus": "获得焦点时显示菜单",
  "options.sites.behavior.noSave": "不询问保存",
  "options.sites.behavior.disabled": "不填充，不询问保存",
  "options.sites.defaultMatch.name": "默认匹配方式",
  "options.sites.defaultMatch.description":
    "对 Bitwarden 条目生效。 Passwords 的匹配由系统决定。",
  "options.sites.rules.title": "按站点覆盖",
  "options.sites.rules.add": "添加规则",
  "options.sites.rules.site": "网址",
  "options.sites.rules.match": "匹配方式",
  "options.sites.rules.backend": "密码库",
  "options.sites.rules.behavior": "行为",
  "options.sites.rules.actions": "操作",
  "options.sites.rules.delete": "删除 {host} 的规则",
  "options.sites.rules.empty": "还没有规则。",
  "options.sites.ruleDialog.description": "规则对这个主机名和它的子域名生效。",
  "options.sites.domains.title": "等价域名",
  "options.sites.domains.add": "添加一组",
  "options.sites.domains.separator": "、",
  "options.sites.domains.description":
    "同一组里的域名共用条目。 Passwords 不受影响。",
  "options.sites.domains.delete": "删除这一组等价域名",
  "options.sites.domains.empty":
    "还没有等价域名。同一组里的域名共用 Bitwarden 条目，Passwords 不受影响。",
  "options.sites.domainDialog.title": "添加等价域名",
  "options.sites.domainDialog.description":
    "输入两个或更多域名，用逗号或空格分隔。",
  "options.sites.domainDialog.input": "域名",
  "options.sites.dialog.cancel": "取消",
  "options.sites.dialog.add": "添加",

  "options.keys.title": "快捷键与外观",
  "options.keys.shortcuts.title": "快捷键",
  "options.keys.shortcuts.change": "在浏览器中修改",
  "options.keys.shortcuts.description":
    "快捷键由浏览器管理，这里显示当前生效的按键。",
  "options.keys.shortcuts.notSet": "未设置",
  "options.keys.command.openPopup": "打开弹窗",
  "options.keys.command.fillFirst": "填充当前站点的第一个匹配",
  "options.keys.command.openGenerator": "打开生成器",
  "options.keys.command.lockAll": "锁定全部密码库",
  "options.keys.appearance.title": "外观",
  "options.keys.theme.name": "主题",
  "options.keys.theme.system": "跟随系统",
  "options.keys.theme.light": "浅色",
  "options.keys.theme.dark": "深色",
  "options.keys.density.name": "列表密度",
  "options.keys.density.description":
    "紧凑时账号名和站点（Bitwarden 为条目名称）显示在同一行，一屏能放更多条目。",
  "options.keys.density.standard": "标准",
  "options.keys.density.compact": "紧凑",
  "options.keys.language.name": "语言",
  "options.keys.language.system": "跟随浏览器",
  "options.keys.language.zhCN": "简体中文",
  "options.keys.language.en": "English",
  "options.keys.file.title": "配置文件",
  "options.keys.export.name": "导出配置",
  "options.keys.export.description":
    "站点规则和填充选项，导出为 JSON 文件。不包含任何密码。",
  "options.keys.export.button": "导出",
  "options.keys.import.name": "导入配置",
  "options.keys.import.description": "导入会覆盖当前的站点规则和填充选项。",
  "options.keys.import.button": "选择文件",
  "options.keys.import.done": "已导入。",
  "options.keys.import.failed": "无法导入：文件不是 Keyward 导出的配置。",

  "options.onboard.title": "登录 Bitwarden",
  "options.onboard.description": "登录后，这个账号用主密码就能解锁。",
  "options.onboard.later": "返回",
  "options.onboard.method.authenticator": "验证器 App",
  "options.onboard.method.authenticatorHint": "输入验证器 App 里显示的验证码。",
  "options.onboard.method.email": "邮件",
  "options.onboard.method.emailHint": "验证码已发送到登录邮箱。",
  "options.onboard.method.recoveryCode": "恢复代码",
  "options.onboard.method.recoveryCodeHint":
    "输入开启两步验证时保存的恢复代码。",
  "options.onboard.method.newDevice": "新设备验证",
  "options.onboard.method.newDeviceHint":
    "服务器已向登录邮箱发送验证码，用来确认这台新设备。",
  "options.onboard.secondStep.method": "验证方式",
  "options.onboard.secondStep.code": "验证码",
  "options.onboard.secondStep.submit": "验证并登录",
  "options.onboard.secondStep.back": "返回",
  "options.onboard.signIn.server": "服务器",
  "options.onboard.signIn.official": "官方服务（bitwarden.com）",
  "options.onboard.signIn.selfHosted": "自建服务器",
  "options.onboard.signIn.serverUrl": "服务器地址",
  "options.onboard.signIn.email": "邮箱",
  "options.onboard.signIn.masterPassword": "主密码",
  "options.onboard.signIn.submit": "登录",
  "options.onboard.signIn.busy": "正在登录…",
}

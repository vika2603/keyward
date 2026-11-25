export const en = {
  "overlay.menu.guard":
    "The menu had just appeared, moved or was covered by the page, so nothing was filled. Choose again.",
  "overlay.menu.noLogins": "No passwords for {host}",
  "overlay.menu.noCodes": "No verification codes for {host}",
  "overlay.menu.code": "Verification code",
  "overlay.menu.recent": "Just used · {site}",
  "overlay.menu.suggest": "Use a strong password",
  "overlay.menu.confirmTouchId": "Confirm with Touch ID or your Mac password.",
  "overlay.prompt.guard":
    "The prompt had just appeared, moved or was covered by the page. Click again.",
  "overlay.prompt.updateTitle": "Update the saved password?",
  "overlay.prompt.saveTitle": "Save this login?",
  "overlay.prompt.close": "Close",
  "overlay.prompt.willUpdate": "Updates this item in {source}",
  "overlay.prompt.saveTo": "Save to",
  "overlay.prompt.confirmOnMac": "Confirm saving in the window on your Mac.",
  "overlay.prompt.never": "Never for this site",
  "overlay.prompt.update": "Update",
  "overlay.prompt.save": "Save",
} as const

export const zhCN: Record<keyof typeof en, string> = {
  "overlay.menu.guard":
    "菜单刚出现、移动过或被页面遮挡，没有填入。请再选一次。",
  "overlay.menu.noLogins": "没有 {host} 的密码",
  "overlay.menu.noCodes": "没有 {host} 的验证码",
  "overlay.menu.code": "验证码",
  "overlay.menu.recent": "刚才使用 · {site}",
  "overlay.menu.suggest": "使用强密码",
  "overlay.menu.confirmTouchId": "用触控 ID 或 Mac 密码确认。",
  "overlay.prompt.guard": "提示刚出现、移动过或被页面遮挡，请再点一次。",
  "overlay.prompt.updateTitle": "更新已保存的密码？",
  "overlay.prompt.saveTitle": "保存这个登录？",
  "overlay.prompt.close": "关闭",
  "overlay.prompt.willUpdate": "将更新 {source} 里的这个条目",
  "overlay.prompt.saveTo": "保存到",
  "overlay.prompt.confirmOnMac": "在 Mac 弹出的窗口中确认保存。",
  "overlay.prompt.never": "此站点不再询问",
  "overlay.prompt.update": "更新",
  "overlay.prompt.save": "保存",
}

import { RequestError } from "@/lib/messaging"

const MESSAGES: Record<string, string> = {
  forbidden: "不允许执行这个操作。",
  locked: "需要先配对或解锁。",
  network: "无法连接服务器。",
  invalidInput: "输入的内容无效。",
  invalidSite: "请输入有效的网址。",
  notFound: "找不到这个条目。",
  unknownSource: "这个后端当前不可用。",
  notWebPage: "当前页面不是网页。",
  fillDisabled: "这个页面不允许填充。",
  pageChanged: "页面已经变化，没有填入。",
  noResponse: "插件后台没有响应，请重试。",
  "apple.unavailable":
    "无法连接 Apple 密码。需要 macOS 上的 Chrome 和系统自带的密码组件。",
  "apple.disabled": "Apple 密码已在设置中关闭。",
  "apple.wrongCode": "验证码不正确。",
  "apple.refused": "Mac 拒绝了这次配对。",
  "apple.protocol": "配对失败，请重新开始。",
  "apple.unsupported": "这台 Mac 的密码组件版本不受支持。",
  "apple.noPairing": "配对已失效，请重新开始。",
  "apple.notSaved":
    "Apple 密码里没有找到这个登录，可能在 Mac 的确认窗口里取消了。",
  "apple.emptyUsername": "Apple 密码需要填写用户名。",
  "apple.unsupportedSite":
    "Apple 密码不保存 localhost、.local、.test 这类本地或保留地址的登录。",
  "apple.query": "Apple 密码请求失败。",
  "bitwarden.wrongPassword": "主密码不正确。",
  "bitwarden.auth": "邮箱、主密码或验证码不正确。",
  "bitwarden.signedOut": "服务器已让这个账号退出，请重新登录。",
  "bitwarden.noPendingSignIn": "登录已过期，请重新开始。",
  "bitwarden.method": "不支持这种验证方式。",
  "bitwarden.reprompt":
    "这个条目设置了重新验证主密码，Keyward 不支持，请在 Bitwarden 里使用。",
  "bitwarden.noData": "还没有同步到数据，请稍后重试。",
}

/** Codes that mean the user replaced or closed the action; they need no message. */
const SILENT = new Set(["cancelled", "overlay.closed"])

/** A message for the user, or null when the error needs none. */
export function errorMessage(error: unknown): string | null {
  if (error instanceof RequestError) {
    if (SILENT.has(error.code)) return null
    const known = MESSAGES[error.code]
    if (known) return known
    if (error.code === "bitwarden.api")
      return `服务器返回错误：${error.message}`
  }
  const text = error instanceof Error ? error.message : String(error)
  return `出错了：${text}`
}

export function errorCodeOf(error: unknown): string | null {
  return error instanceof RequestError ? error.code : null
}

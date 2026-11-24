import { ExternalLinkIcon, PlusIcon } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { callBackground } from "@/background/api"
import { BrandIcon } from "@/components/keyward/brand-icon"
import { errorMessage } from "@/components/keyward/errors"
import { SourceSelect } from "@/components/keyward/source-select"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { APPLE_SOURCE_ID } from "@/lib/backends/apple/source-id"
import type { AccountSummary } from "@/lib/backends/bitwarden/bitwarden-backend"
import type { SourceInfo } from "@/lib/backends/types"
import { navigate } from "./App"
import { Card, Option, PageHeader, Section } from "./parts"
import { useSettings } from "./use-settings"

const LOCK_TIMES: [string, string][] = [
  ["1", "1 分钟"],
  ["5", "5 分钟"],
  ["15", "15 分钟"],
  ["30", "30 分钟"],
  ["60", "1 小时"],
  ["240", "4 小时"],
  ["never", "退出浏览器时"],
]

export function BackendsPage() {
  const [settings, update] = useSettings()
  const [accounts, setAccounts] = useState<AccountSummary[]>([])
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(() => {
    void callBackground("bitwarden.accounts", null).then(setAccounts)
  }, [])
  useEffect(load, [load])

  if (!settings) return null

  const signOut = async (account: AccountSummary) => {
    if (
      !confirm(
        `退出 ${account.email}？之后需要重新输入主密码和两步验证码登录。`,
      )
    )
      return
    await callBackground("bitwarden.signOut", { accountId: account.id })
    load()
  }

  const openApp = async () => {
    setMessage(null)
    try {
      await callBackground("apple.openPasswordsApp", null)
    } catch (error) {
      setMessage(errorMessage(error))
    }
  }

  const targets: SourceInfo[] = [
    ...(settings.appleEnabled
      ? [
          {
            id: APPLE_SOURCE_ID,
            kind: "apple" as const,
            label: "Apple 密码",
            status: "ready" as const,
          },
        ]
      : []),
    ...accounts.map((a) => ({
      id: a.sourceId,
      kind: "bitwarden" as const,
      label: a.email,
      status: "ready" as const,
    })),
  ]
  const defaultTarget =
    targets.find((t) => t.id === settings.defaultSaveTarget)?.id ??
    targets[0]?.id ??
    null

  return (
    <>
      <PageHeader
        title="后端"
        description="弹窗和页面内菜单里的条目来自这里连接的后端。"
      />
      <Card>
        <Option
          name={
            <span className="flex items-center gap-2.5">
              <BrandIcon kind="apple" />
              Apple 密码
            </span>
          }
          description="连接不会长期保留，需要时在弹窗里输入 Mac 上显示的六位验证码。"
        >
          <Switch
            aria-label="使用 Apple 密码"
            checked={settings.appleEnabled}
            onCheckedChange={(checked) => update({ appleEnabled: checked })}
          />
        </Option>
        {settings.appleEnabled && (
          <Option
            name="可用操作"
            description="按当前站点列出账号、填充、复制密码和保存新密码。其余管理操作在密码 App 中完成。"
          >
            <Button variant="outline" onClick={() => void openApp()}>
              <ExternalLinkIcon />
              打开密码 App
            </Button>
          </Option>
        )}
        {message && (
          <p className="px-4 pb-3 text-sm text-destructive">{message}</p>
        )}
      </Card>
      <Card>
        <Option
          name={
            <span className="flex items-center gap-2.5">
              <BrandIcon kind="bitwarden" />
              Bitwarden
            </span>
          }
          description={
            accounts.length
              ? "可以同时登录多个账号，条目一起显示。锁定后在弹窗里逐个输入主密码解锁。"
              : "尚未登录。支持官方服务和自建服务器，可以同时登录多个账号。"
          }
        >
          {accounts.length ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("onboard")}
            >
              <PlusIcon />
              添加账号
            </Button>
          ) : (
            <Button size="sm" onClick={() => navigate("onboard")}>
              登录
            </Button>
          )}
        </Option>
        {accounts.map((account) => (
          <Option
            key={account.id}
            name={account.email}
            description={account.server || "官方服务"}
          >
            <Button variant="outline" onClick={() => void signOut(account)}>
              退出登录
            </Button>
          </Option>
        ))}
        {accounts.length > 0 && (
          <Option
            name="自动锁定"
            description="超过这段时间没有使用插件就锁定，之后需要再次输入主密码。退出浏览器后也要重新解锁。"
          >
            <Select
              value={
                settings.autoLockMinutes === null
                  ? "never"
                  : String(settings.autoLockMinutes)
              }
              onValueChange={(value) =>
                update({
                  autoLockMinutes: value === "never" ? null : Number(value),
                })
              }
              items={LOCK_TIMES.map(([value, label]) => ({ value, label }))}
            >
              <SelectTrigger aria-label="自动锁定时间">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOCK_TIMES.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Option>
        )}
      </Card>
      {targets.length > 0 && (
        <Section title="保存位置">
          <Card>
            <Option
              name="新登录默认保存到"
              description="保存提示里仍可临时改选。"
            >
              <div className="w-64 max-w-full">
                <SourceSelect
                  sources={targets}
                  value={defaultTarget}
                  onChange={(id) => update({ defaultSaveTarget: id })}
                  label="新登录默认保存到"
                />
              </div>
            </Option>
          </Card>
        </Section>
      )}
    </>
  )
}

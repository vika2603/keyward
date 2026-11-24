import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Card, Option, PageHeader, Section, Segmented } from "./parts"
import { useSettings } from "./use-settings"

const CLEAR_TIMES: [string, string][] = [
  ["30", "30 秒"],
  ["60", "1 分钟"],
  ["120", "2 分钟"],
  ["300", "5 分钟"],
  ["never", "从不"],
]

export function FillPage() {
  const [settings, update] = useSettings()
  if (!settings) return null

  return (
    <>
      <PageHeader
        title="填充与保存"
        description="对所有站点生效，可在站点规则里按站点覆盖。"
      />
      <Section title="页面内菜单">
        <Card>
          <Option
            name="何时显示候选菜单"
            description="图标显示在登录和注册表单的输入框里。选择点击图标时，菜单不会自动弹出遮挡页面。"
          >
            <Segmented
              label="何时显示候选菜单"
              value={settings.menuTrigger}
              options={[
                ["click", "点击图标时"],
                ["focus", "输入框获得焦点时"],
              ]}
              onChange={(menuTrigger) => update({ menuTrigger })}
            />
          </Option>
          <Option
            name="在跨域框架中显示"
            description="登录框嵌在其他域名的框架里时也提供候选。"
          >
            <Switch
              aria-label="在跨域框架中显示"
              checked={settings.crossOriginFrames}
              onCheckedChange={(checked) =>
                update({ crossOriginFrames: checked })
              }
            />
          </Option>
        </Card>
      </Section>
      <Section title="自动填充">
        <Card>
          <Option
            name="填充后自动提交"
            description="填入用户名和密码后提交登录表单。只对有提交按钮的普通表单有效。"
          >
            <Switch
              aria-label="填充后自动提交"
              checked={settings.autoSubmit}
              onCheckedChange={(checked) => update({ autoSubmit: checked })}
            />
          </Option>
        </Card>
      </Section>
      <Section title="保存">
        <Card>
          <Option
            name="询问保存新登录"
            description="检测到登录或注册表单提交后显示保存提示，个别站点可能检测不到。"
          >
            <Switch
              aria-label="询问保存新登录"
              checked={settings.askSave}
              onCheckedChange={(checked) => update({ askSave: checked })}
            />
          </Option>
          <Option
            name="询问更新已变更的密码"
            description="提交的密码与已保存的不一致时显示更新提示。"
          >
            <Switch
              aria-label="询问更新已变更的密码"
              checked={settings.askUpdate}
              onCheckedChange={(checked) => update({ askUpdate: checked })}
            />
          </Option>
        </Card>
      </Section>
      <Section title="剪贴板">
        <Card>
          <Option
            name="自动覆盖剪贴板"
            description="复制密码后，经过这段时间用空内容覆盖剪贴板。系统或剪贴板工具留存的历史不受影响。"
          >
            <Select
              value={
                settings.clipboardClearSeconds === null
                  ? "never"
                  : String(settings.clipboardClearSeconds)
              }
              onValueChange={(value) =>
                update({
                  clipboardClearSeconds:
                    value === "never" ? null : Number(value),
                })
              }
              items={CLEAR_TIMES.map(([value, label]) => ({ value, label }))}
            >
              <SelectTrigger aria-label="覆盖剪贴板前的等待时间">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CLEAR_TIMES.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Option>
        </Card>
      </Section>
    </>
  )
}

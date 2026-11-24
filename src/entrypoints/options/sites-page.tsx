import { PlusIcon, Trash2Icon } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  MatchType,
  type RuleBackend,
  type SiteBehavior,
  type SiteRule,
} from "@/lib/settings"
import { hostOfSavedUri } from "@/lib/site"
import { Card, Option, PageHeader, Section } from "./parts"
import { useSettings } from "./use-settings"

const MATCH_NAMES: [MatchType, string][] = [
  [MatchType.Domain, "主域名"],
  [MatchType.Host, "主机名"],
  [MatchType.StartsWith, "开头一致"],
  [MatchType.Exact, "完全一致"],
  [MatchType.RegularExpression, "正则表达式"],
  [MatchType.Never, "从不匹配"],
]
const BACKEND_NAMES: [RuleBackend, string][] = [
  ["all", "全部"],
  ["apple", "Apple 密码"],
  ["bitwarden", "Bitwarden"],
]
const BEHAVIOR_NAMES: [SiteBehavior, string][] = [
  ["default", "默认"],
  ["menuOnClick", "点击图标时显示菜单"],
  ["menuOnFocus", "获得焦点时显示菜单"],
  ["noSave", "不询问保存"],
  ["disabled", "不填充，不询问保存"],
]

function nameOf<T>(names: [T, string][], value: T): string {
  return names.find(([v]) => v === value)?.[1] ?? ""
}

function ChoiceSelect<T extends string | number>({
  names,
  value,
  onChange,
  label,
  className,
}: {
  names: [T, string][]
  value: T
  onChange: (value: T) => void
  label: string
  className?: string
}) {
  return (
    <Select
      value={String(value)}
      onValueChange={(next) => {
        const found = names.find(([v]) => String(v) === next)
        if (found) onChange(found[0])
      }}
      items={names.map(([v, text]) => ({ value: String(v), label: text }))}
    >
      <SelectTrigger aria-label={label} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {names.map(([v, text]) => (
          <SelectItem key={String(v)} value={String(v)}>
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function SitesPage() {
  const [settings, update] = useSettings()
  const [addingRule, setAddingRule] = useState(false)
  const [addingGroup, setAddingGroup] = useState(false)
  if (!settings) return null

  const ruleMatch = (rule: SiteRule) => {
    if (rule.backend === "apple")
      return <span className="text-muted-foreground">由系统决定</span>
    return rule.match === null
      ? `默认（${nameOf(MATCH_NAMES, settings.defaultMatch)}）`
      : nameOf(MATCH_NAMES, rule.match)
  }

  return (
    <>
      <PageHeader
        title="站点规则"
        description="决定条目与网址如何匹配，并按站点覆盖默认行为。"
      />
      <Card>
        <Option
          name="默认匹配方式"
          description="对 Bitwarden 条目生效。Apple 密码的匹配由系统决定。"
        >
          <ChoiceSelect
            names={MATCH_NAMES}
            value={settings.defaultMatch}
            onChange={(defaultMatch) => update({ defaultMatch })}
            label="默认匹配方式"
          />
        </Option>
      </Card>
      <Section
        title="按站点覆盖"
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAddingRule(true)}
          >
            <PlusIcon />
            添加规则
          </Button>
        }
      >
        <Card className="overflow-x-auto">
          {settings.siteRules.length ? (
            <Table className="min-w-[540px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">网址</TableHead>
                  <TableHead className="px-4">匹配方式</TableHead>
                  <TableHead className="px-4">后端</TableHead>
                  <TableHead className="px-4">行为</TableHead>
                  <TableHead className="px-4">
                    <span className="sr-only">操作</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {settings.siteRules.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell className="px-4">{rule.host}</TableCell>
                    <TableCell className="px-4">{ruleMatch(rule)}</TableCell>
                    <TableCell className="px-4">
                      {nameOf(BACKEND_NAMES, rule.backend)}
                    </TableCell>
                    <TableCell className="px-4">
                      {nameOf(BEHAVIOR_NAMES, rule.behavior)}
                    </TableCell>
                    <TableCell className="px-4 text-right">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`删除 ${rule.host} 的规则`}
                        onClick={() =>
                          update({
                            siteRules: settings.siteRules.filter(
                              (r) => r.id !== rule.id,
                            ),
                          })
                        }
                      >
                        <Trash2Icon />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              还没有规则。
            </p>
          )}
        </Card>
      </Section>
      <Section
        title="等价域名"
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAddingGroup(true)}
          >
            <PlusIcon />
            添加一组
          </Button>
        }
      >
        <Card>
          {settings.equivalentDomains.length ? (
            settings.equivalentDomains.map((group, index) => (
              <Option
                key={group.join(",")}
                name={group.join("、")}
                description="同一组里的域名共用条目。Apple 密码不受影响。"
              >
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="删除这一组等价域名"
                  onClick={() =>
                    update({
                      equivalentDomains: settings.equivalentDomains.filter(
                        (_, i) => i !== index,
                      ),
                    })
                  }
                >
                  <Trash2Icon />
                </Button>
              </Option>
            ))
          ) : (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              还没有等价域名。同一组里的域名共用 Bitwarden 条目，Apple
              密码不受影响。
            </p>
          )}
        </Card>
      </Section>
      <RuleDialog
        open={addingRule}
        onClose={() => setAddingRule(false)}
        onAdd={(rule) =>
          update({
            siteRules: [
              ...settings.siteRules.filter((r) => r.host !== rule.host),
              rule,
            ],
          })
        }
      />
      <DomainGroupDialog
        open={addingGroup}
        onClose={() => setAddingGroup(false)}
        onAdd={(group) =>
          update({ equivalentDomains: [...settings.equivalentDomains, group] })
        }
      />
    </>
  )
}

function RuleDialog({
  open,
  onClose,
  onAdd,
}: {
  open: boolean
  onClose: () => void
  onAdd: (rule: SiteRule) => void
}) {
  const [site, setSite] = useState("")
  const [match, setMatch] = useState<MatchType | "default">("default")
  const [backend, setBackend] = useState<RuleBackend>("all")
  const [behavior, setBehavior] = useState<SiteBehavior>("default")
  const host = hostOfSavedUri(site)

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (!host) return
            onAdd({
              id: crypto.randomUUID(),
              host,
              match: match === "default" ? null : match,
              backend,
              behavior,
            })
            setSite("")
            onClose()
          }}
        >
          <DialogHeader>
            <DialogTitle>添加规则</DialogTitle>
            <DialogDescription>
              规则对这个主机名和它的子域名生效。
            </DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-2">
            <span className="text-sm leading-none font-medium">网址</span>
            <Input
              value={site}
              onChange={(event) => setSite(event.target.value)}
              placeholder="example.com"
              autoFocus
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <span className="text-sm leading-none font-medium">后端</span>
              <ChoiceSelect
                names={BACKEND_NAMES}
                value={backend}
                onChange={setBackend}
                label="后端"
                className="w-full"
              />
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-sm leading-none font-medium">匹配方式</span>
              <ChoiceSelect<MatchType | "default">
                names={[["default", "默认"], ...MATCH_NAMES]}
                value={match}
                onChange={setMatch}
                label="匹配方式"
                className="w-full"
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm leading-none font-medium">行为</span>
            <ChoiceSelect
              names={BEHAVIOR_NAMES}
              value={behavior}
              onChange={setBehavior}
              label="行为"
              className="w-full"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={!host}>
              添加
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DomainGroupDialog({
  open,
  onClose,
  onAdd,
}: {
  open: boolean
  onClose: () => void
  onAdd: (group: string[]) => void
}) {
  const [text, setText] = useState("")
  const domains = [
    ...new Set(
      text
        .split(/[\s,，、]+/)
        .map((d) => hostOfSavedUri(d))
        .filter((d) => d !== null),
    ),
  ]

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (domains.length < 2) return
            onAdd(domains)
            setText("")
            onClose()
          }}
        >
          <DialogHeader>
            <DialogTitle>添加等价域名</DialogTitle>
            <DialogDescription>
              输入两个或更多域名，用逗号或空格分隔。
            </DialogDescription>
          </DialogHeader>
          <Input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="example.com, example.net"
            aria-label="域名"
            autoFocus
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={domains.length < 2}>
              添加
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

import { PlusIcon, Trash2Icon } from "lucide-react"
import { useState } from "react"
import { providerName } from "@/components/keyward/brand-icon"
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
import { t } from "@/lib/i18n"
import {
  MatchType,
  type RuleProvider,
  type SiteBehavior,
  type SiteRule,
} from "@/lib/settings"
import { hostOfSavedUri, siteDomainOf } from "@/lib/site"
import { Card, Option, PageHeader, Section } from "./parts"
import { useSettings } from "./use-settings"

function matchNames(): [MatchType, string][] {
  return [
    [MatchType.Domain, t("options.sites.match.domain")],
    [MatchType.Host, t("options.sites.match.host")],
    [MatchType.StartsWith, t("options.sites.match.startsWith")],
    [MatchType.Exact, t("options.sites.match.exact")],
    [MatchType.RegularExpression, t("options.sites.match.regularExpression")],
    [MatchType.Never, t("options.sites.match.never")],
  ]
}
function providerNames(): [RuleProvider, string][] {
  return [
    ["all", t("options.sites.provider.all")],
    ["apple", providerName("apple")],
    ["bitwarden", providerName("bitwarden")],
  ]
}
function behaviorNames(): [SiteBehavior, string][] {
  return [
    ["default", t("options.sites.behavior.default")],
    ["menuOnClick", t("options.sites.behavior.menuOnClick")],
    ["menuOnFocus", t("options.sites.behavior.menuOnFocus")],
    ["noSave", t("options.sites.behavior.noSave")],
    ["disabled", t("options.sites.behavior.disabled")],
  ]
}

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
    if (rule.provider === "apple")
      return (
        <span className="text-muted-foreground">
          {t("options.sites.match.bySystem")}
        </span>
      )
    return rule.match === null
      ? t("options.sites.match.defaultWith", {
          match: nameOf(matchNames(), settings.defaultMatch),
        })
      : nameOf(matchNames(), rule.match)
  }

  return (
    <>
      <PageHeader
        title={t("options.sites.title")}
        description={t("options.sites.description")}
      />
      <Card>
        <Option
          name={t("options.sites.defaultMatch.name")}
          description={t("options.sites.defaultMatch.description")}
        >
          <ChoiceSelect
            names={matchNames()}
            value={settings.defaultMatch}
            onChange={(defaultMatch) => update({ defaultMatch })}
            label={t("options.sites.defaultMatch.name")}
          />
        </Option>
      </Card>
      <Section
        title={t("options.sites.rules.title")}
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAddingRule(true)}
          >
            <PlusIcon />
            {t("options.sites.rules.add")}
          </Button>
        }
      >
        <Card className="overflow-x-auto">
          {settings.siteRules.length ? (
            <Table className="min-w-[540px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">
                    {t("options.sites.rules.site")}
                  </TableHead>
                  <TableHead className="px-4">
                    {t("options.sites.rules.match")}
                  </TableHead>
                  <TableHead className="px-4">
                    {t("options.sites.rules.provider")}
                  </TableHead>
                  <TableHead className="px-4">
                    {t("options.sites.rules.behavior")}
                  </TableHead>
                  <TableHead className="px-4">
                    <span className="sr-only">
                      {t("options.sites.rules.actions")}
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {settings.siteRules.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell className="px-4">{rule.host}</TableCell>
                    <TableCell className="px-4">{ruleMatch(rule)}</TableCell>
                    <TableCell className="px-4">
                      {nameOf(providerNames(), rule.provider)}
                    </TableCell>
                    <TableCell className="px-4">
                      {nameOf(behaviorNames(), rule.behavior)}
                    </TableCell>
                    <TableCell className="px-4 text-right">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("options.sites.rules.delete", {
                          host: rule.host,
                        })}
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
              {t("options.sites.rules.empty")}
            </p>
          )}
        </Card>
      </Section>
      <Section
        title={t("options.sites.domains.title")}
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAddingGroup(true)}
          >
            <PlusIcon />
            {t("options.sites.domains.add")}
          </Button>
        }
      >
        <Card>
          {settings.equivalentDomains.length ? (
            settings.equivalentDomains.map((group, index) => (
              <Option
                key={group.join(",")}
                name={group.join(t("options.sites.domains.separator"))}
                description={t("options.sites.domains.description")}
              >
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("options.sites.domains.delete")}
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
              {t("options.sites.domains.empty")}
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
  const [provider, setProvider] = useState<RuleProvider>("all")
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
              provider,
              behavior,
            })
            setSite("")
            onClose()
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("options.sites.rules.add")}</DialogTitle>
            <DialogDescription>
              {t("options.sites.ruleDialog.description")}
            </DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-2">
            <span className="text-sm leading-none font-medium">
              {t("options.sites.rules.site")}
            </span>
            <Input
              value={site}
              onChange={(event) => setSite(event.target.value)}
              placeholder="example.com"
              autoFocus
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <span className="text-sm leading-none font-medium">
                {t("options.sites.rules.provider")}
              </span>
              <ChoiceSelect
                names={providerNames()}
                value={provider}
                onChange={setProvider}
                label={t("options.sites.rules.provider")}
                className="w-full"
              />
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-sm leading-none font-medium">
                {t("options.sites.rules.match")}
              </span>
              <ChoiceSelect<MatchType | "default">
                names={[
                  ["default", t("options.sites.match.default")],
                  ...matchNames(),
                ]}
                value={match}
                onChange={setMatch}
                label={t("options.sites.rules.match")}
                className="w-full"
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm leading-none font-medium">
              {t("options.sites.rules.behavior")}
            </span>
            <ChoiceSelect
              names={behaviorNames()}
              value={behavior}
              onChange={setBehavior}
              label={t("options.sites.rules.behavior")}
              className="w-full"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("options.sites.dialog.cancel")}
            </Button>
            <Button type="submit" disabled={!host}>
              {t("options.sites.dialog.add")}
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
        .map((entry) => hostOfSavedUri(entry))
        .filter((host) => host !== null)
        .map(siteDomainOf),
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
            <DialogTitle>{t("options.sites.domainDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("options.sites.domainDialog.description")}
            </DialogDescription>
          </DialogHeader>
          <Input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="example.com, example.net"
            aria-label={t("options.sites.domainDialog.input")}
            autoFocus
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("options.sites.dialog.cancel")}
            </Button>
            <Button type="submit" disabled={domains.length < 2}>
              {t("options.sites.dialog.add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

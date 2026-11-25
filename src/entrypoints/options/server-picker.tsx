import { ChevronDownIcon } from "lucide-react"
import { useId, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { t } from "@/lib/i18n"
import {
  type CustomEndpoints,
  EU_SERVER,
  normalizeServerAddress,
  serverHost,
} from "@/lib/providers/bitwarden/server"
import { cn } from "@/lib/utils"
import { useDialogOpening } from "./parts"

export type ServerChoice = "us" | "eu" | "selfHosted"

export interface SelfHostedServer {
  /** The server's address, normalized; empty until one is set up. */
  address: string
  endpoints: CustomEndpoints
}

/** The address a sign-in goes to for a choice; empty for bitwarden.com. */
export function serverAddressOf(
  choice: ServerChoice,
  selfHosted: SelfHostedServer,
): string {
  if (choice === "us") return ""
  if (choice === "eu") return EU_SERVER
  return selfHosted.address
}

/** The choice an address stands for. */
export function serverChoiceOf(address: string): ServerChoice {
  if (address === "") return "us"
  return address === EU_SERVER ? "eu" : "selfHosted"
}

function selfHostedValue(server: SelfHostedServer): string {
  return `selfHosted:${server.address}`
}

/**
 * "Accessing: bitwarden.com", with a menu of Bitwarden's two cloud regions, the self-hosted servers
 * known so far, and an entry that sets up another one.
 */
export function ServerPicker({
  choice,
  selfHosted,
  known,
  onChoose,
  onSelfHosted,
}: {
  choice: ServerChoice
  selfHosted: SelfHostedServer
  /** Self-hosted servers to offer, such as those of the signed-in accounts. */
  known: readonly SelfHostedServer[]
  onChoose: (choice: ServerChoice) => void
  /** A self-hosted server was chosen or set up; it becomes the choice. */
  onSelfHosted: (server: SelfHostedServer) => void
}) {
  const [editing, setEditing] = useState(false)
  const servers =
    selfHosted.address &&
    !known.some((server) => server.address === selfHosted.address)
      ? [...known, selfHosted]
      : known
  const host =
    choice === "selfHosted" && !selfHosted.address
      ? t("options.onboard.signIn.selfHosted")
      : serverHost(serverAddressOf(choice, selfHosted))

  return (
    <div className="flex items-center justify-center gap-1 text-sm text-muted-foreground">
      <span>{t("options.onboard.server.accessing")}</span>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="link"
              size="sm"
              className="h-auto max-w-56 px-0 text-sm"
            />
          }
          aria-label={t("options.onboard.server.label", { host })}
        >
          <span className="truncate">{host}</span>
          <ChevronDownIcon data-icon="inline-end" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="w-auto min-w-40">
          <DropdownMenuRadioGroup
            value={
              choice === "selfHosted" ? selfHostedValue(selfHosted) : choice
            }
            onValueChange={(value) => {
              if (value === "us" || value === "eu") onChoose(value)
              const server = servers.find(
                (candidate) => selfHostedValue(candidate) === value,
              )
              if (server) onSelfHosted(server)
            }}
          >
            <DropdownMenuRadioItem value="us" closeOnClick>
              bitwarden.com
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="eu" closeOnClick>
              bitwarden.eu
            </DropdownMenuRadioItem>
            {servers.map((server) => (
              <DropdownMenuRadioItem
                key={server.address}
                value={selfHostedValue(server)}
                closeOnClick
              >
                <span className="max-w-64 truncate">
                  {serverHost(server.address)}
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => setEditing(true)}>
              {servers.length
                ? t("options.onboard.server.addSelfHosted")
                : t("options.onboard.signIn.selfHosted")}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <SelfHostedDialog
        open={editing}
        onClose={() => setEditing(false)}
        onSave={(server) => {
          setEditing(false)
          onSelfHosted(server)
        }}
      />
    </div>
  )
}

/** A server address, normalized; empty for empty text, null for text that is not an address. */
export function tryNormalizeServerAddress(text: string): string | null {
  try {
    return normalizeServerAddress(text)
  } catch {
    return null
  }
}

function SelfHostedDialog({
  open,
  onClose,
  onSave,
}: {
  open: boolean
  onClose: () => void
  onSave: (server: SelfHostedServer) => void
}) {
  const [address, setAddress] = useState("")
  const [api, setApi] = useState("")
  const [identity, setIdentity] = useState("")
  const [customOpen, setCustomOpen] = useState(false)
  // Each opening sets up a new server.
  useDialogOpening(open || null, () => {
    setAddress("")
    setApi("")
    setIdentity("")
    setCustomOpen(false)
  })

  const checked = {
    address: tryNormalizeServerAddress(address),
    api: tryNormalizeServerAddress(api),
    identity: tryNormalizeServerAddress(identity),
  }
  const valid =
    Boolean(checked.address) &&
    checked.api !== null &&
    checked.identity !== null

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            // React passes the submit on to the sign-in form this dialog is rendered in, which
            // would sign in with the fields as they are.
            event.stopPropagation()
            if (!valid || !checked.address) return
            const endpoints: CustomEndpoints = {}
            if (checked.api) endpoints.api = checked.api
            if (checked.identity) endpoints.identity = checked.identity
            onSave({ address: checked.address, endpoints })
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("options.onboard.server.dialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("options.onboard.server.dialogDescription")}
            </DialogDescription>
          </DialogHeader>
          <AddressField
            label={t("options.onboard.signIn.serverUrl")}
            value={address}
            invalid={address.trim() !== "" && checked.address === null}
            onChange={setAddress}
            placeholder="https://vault.example.com"
            autoFocus
          />
          <Collapsible open={customOpen} onOpenChange={setCustomOpen}>
            <CollapsibleTrigger className="flex items-center gap-1 rounded-md text-sm font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
              <ChevronDownIcon
                className={cn(
                  "size-4 transition-transform",
                  !customOpen && "-rotate-90",
                )}
              />
              {t("options.onboard.server.custom")}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="flex flex-col gap-4 pt-3">
                <p className="text-sm text-muted-foreground">
                  {t("options.onboard.server.customDescription")}
                </p>
                <AddressField
                  label={t("options.onboard.server.api")}
                  value={api}
                  invalid={checked.api === null}
                  onChange={setApi}
                  placeholder="https://api.example.com"
                />
                <AddressField
                  label={t("options.onboard.server.identity")}
                  value={identity}
                  invalid={checked.identity === null}
                  onChange={setIdentity}
                  placeholder="https://identity.example.com"
                />
              </div>
            </CollapsibleContent>
          </Collapsible>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("options.onboard.server.cancel")}
            </Button>
            <Button type="submit" disabled={!valid}>
              {t("options.onboard.server.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AddressField({
  label,
  value,
  invalid,
  onChange,
  placeholder,
  autoFocus = false,
}: {
  label: string
  value: string
  invalid: boolean
  onChange: (value: string) => void
  placeholder: string
  autoFocus?: boolean
}) {
  const id = useId()
  return (
    <Field>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        inputMode="url"
        spellCheck={false}
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-invalid={invalid}
        autoFocus={autoFocus}
      />
      {invalid && (
        <span className="text-xs text-destructive">
          {t("options.onboard.server.invalid")}
        </span>
      )}
    </Field>
  )
}

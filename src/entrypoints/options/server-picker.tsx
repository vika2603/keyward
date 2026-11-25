import { ChevronDownIcon } from "lucide-react"
import { useState } from "react"
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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { t } from "@/lib/i18n"
import {
  type CustomEndpoints,
  EU_SERVER,
  normalizeServerAddress,
  serverHost,
} from "@/lib/providers/bitwarden/server"
import { cn } from "@/lib/utils"

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

/**
 * "Accessing: bitwarden.com", with a menu of Bitwarden's two cloud regions and a self-hosted
 * server. Choosing the self-hosted server, even when it is already chosen, opens its settings.
 */
export function ServerPicker({
  choice,
  selfHosted,
  onChoose,
  onSelfHosted,
}: {
  choice: ServerChoice
  selfHosted: SelfHostedServer
  onChoose: (choice: ServerChoice) => void
  /** The self-hosted server was set up; it becomes the choice. */
  onSelfHosted: (server: SelfHostedServer) => void
}) {
  const [editing, setEditing] = useState(false)
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
            value={choice}
            onValueChange={(value) => {
              if (value !== "selfHosted") onChoose(value as ServerChoice)
            }}
          >
            <DropdownMenuRadioItem value="us" closeOnClick>
              bitwarden.com
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="eu" closeOnClick>
              bitwarden.eu
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem
              value="selfHosted"
              closeOnClick
              onClick={() => setEditing(true)}
            >
              {t("options.onboard.signIn.selfHosted")}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <SelfHostedDialog
        open={editing}
        saved={selfHosted}
        onClose={() => setEditing(false)}
        onSave={(server) => {
          setEditing(false)
          onSelfHosted(server)
        }}
      />
    </div>
  )
}

/** The address in a field, normalized; empty for an empty field, null for one that is not an address. */
function addressIn(text: string): string | null {
  try {
    return normalizeServerAddress(text)
  } catch {
    return null
  }
}

function SelfHostedDialog({
  open,
  saved,
  onClose,
  onSave,
}: {
  open: boolean
  saved: SelfHostedServer
  onClose: () => void
  onSave: (server: SelfHostedServer) => void
}) {
  const [address, setAddress] = useState("")
  const [api, setApi] = useState("")
  const [identity, setIdentity] = useState("")
  const [customOpen, setCustomOpen] = useState(false)
  /** Whether the fields hold this opening's values; each opening starts from the saved server. */
  const [filled, setFilled] = useState(false)
  if (open !== filled) {
    setFilled(open)
    if (open) {
      setAddress(saved.address)
      setApi(saved.endpoints.api ?? "")
      setIdentity(saved.endpoints.identity ?? "")
      setCustomOpen(Boolean(saved.endpoints.api || saved.endpoints.identity))
    }
  }

  const checked = {
    address: addressIn(address),
    api: addressIn(api),
    identity: addressIn(identity),
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
  return (
    <label className="flex flex-col gap-2">
      <span className="text-sm leading-none font-medium">{label}</span>
      <Input
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
    </label>
  )
}

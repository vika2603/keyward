import { VaultError } from "./providers/types"
import { isLoopbackHost } from "./site"

export const FORWARDING_SERVICES = [
  "simplelogin",
  "addyio",
  "fastmail",
  "firefoxRelay",
  "duckduckgo",
  "forwardEmail",
] as const

export type ForwardingService = (typeof FORWARDING_SERVICES)[number]

export function isForwardingService(
  value: unknown,
): value is ForwardingService {
  return FORWARDING_SERVICES.some((service) => service === value)
}

/** What the user entered for one service; each service keeps its own, so a key goes only to its service. */
export interface ForwardingSettings {
  apiKey: string
  /** Required by Addy.io and ForwardEmail. */
  domain: string
  /** A self-hosted SimpleLogin or Addy.io server; empty for the service's own. */
  baseUrl: string
}

export type SavedForwarding = Partial<
  Record<ForwardingService, ForwardingSettings>
>

export const emptyForwardingSettings: ForwardingSettings = {
  apiKey: "",
  domain: "",
  baseUrl: "",
}

export interface ForwardingConfig {
  service: ForwardingService
  apiKey: string
  /** Required for Addy.io and ForwardEmail; optional/unused for others. */
  domain?: string
  /** Optional custom self-hosted base URL for SimpleLogin or Addy.io. */
  baseUrl?: string
  /** Optional active site hostname for alias note/description context. */
  website?: string
}

/** The servers of the services that can also be self-hosted. */
export const DEFAULT_BASE_URLS: Partial<Record<ForwardingService, string>> = {
  simplelogin: "https://app.simplelogin.io",
  addyio: "https://app.addy.io",
}

function normalizedBaseUrl(service: ForwardingService, raw?: string): string {
  const candidate = (raw?.trim() || DEFAULT_BASE_URLS[service] || "").replace(
    /\/+$/,
    "",
  )
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    throw new VaultError("Invalid forwarding service URL", "invalidSite")
  }
  // The API key travels in a header, so plain HTTP is only for a server on this computer.
  const secure =
    parsed.protocol === "https:" ||
    (parsed.protocol === "http:" && isLoopbackHost(parsed.hostname))
  if (!secure)
    throw new VaultError("Invalid forwarding service URL", "invalidSite")
  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "")
}

function aliasNote(website?: string): string {
  return website ? `Generated for ${website}` : ""
}

function requireDomain(config: ForwardingConfig, provider: string): string {
  const domain = config.domain?.trim()
  if (!domain)
    throw new VaultError(`${provider} requires a domain`, "invalidInput")
  return domain
}

function requireAlias(value: unknown, provider: string): string {
  if (typeof value !== "string" || !value)
    throw new VaultError(`${provider} returned no alias`, "network")
  return value
}

function randomAliasLocalPart(length = 10): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("")
}

async function requestJson(
  url: string,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      cache: "no-store",
      credentials: "omit",
    })
  } catch (error) {
    throw new VaultError("Could not reach the forwarding service", "network", {
      cause: error,
    })
  }
  const text = await response.text()
  let parsed: Record<string, unknown> | null = null
  try {
    const json: unknown = text ? JSON.parse(text) : null
    if (json && typeof json === "object")
      parsed = json as Record<string, unknown>
  } catch {
    parsed = null
  }
  if (!response.ok || !parsed) {
    const detail =
      (typeof parsed?.error === "string" && parsed.error) ||
      (typeof parsed?.message === "string" && parsed.message) ||
      `Service responded with status ${response.status}`
    throw new VaultError(detail, "network")
  }
  return parsed
}

function postJson(
  url: string,
  headers: Record<string, string>,
  payload?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return requestJson(url, {
    method: "POST",
    headers: payload
      ? { "Content-Type": "application/json", ...headers }
      : headers,
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  })
}

async function createSimpleLogin(config: ForwardingConfig): Promise<string> {
  const base = normalizedBaseUrl("simplelogin", config.baseUrl)
  const query = config.website
    ? `?hostname=${encodeURIComponent(config.website)}`
    : ""
  const body = await postJson(
    `${base}/api/alias/random/new${query}`,
    { Authentication: config.apiKey },
    { note: aliasNote(config.website) },
  )
  return requireAlias(body.email, "SimpleLogin")
}

async function createAddyIo(config: ForwardingConfig): Promise<string> {
  const base = normalizedBaseUrl("addyio", config.baseUrl)
  const domain = requireDomain(config, "Addy.io")
  const body = await postJson(
    `${base}/api/v1/aliases`,
    {
      Authorization: `Bearer ${config.apiKey}`,
      "X-Requested-With": "XMLHttpRequest",
    },
    { domain, description: aliasNote(config.website) },
  )
  const data = body.data as Record<string, unknown> | undefined
  return requireAlias(data?.email, "Addy.io")
}

async function createFastmail(config: ForwardingConfig): Promise<string> {
  const capability = "https://www.fastmail.com/dev/maskedemail"
  const headers = {
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
  }
  const session = await requestJson("https://api.fastmail.com/jmap/session", {
    method: "GET",
    headers,
  })
  const apiUrl = session.apiUrl
  const primaryAccounts = session.primaryAccounts as
    | Record<string, unknown>
    | undefined
  const accountId = primaryAccounts?.[capability]
  if (typeof apiUrl !== "string" || typeof accountId !== "string") {
    throw new VaultError(
      "Fastmail session lacked Masked Email access",
      "network",
    )
  }
  const jmap = await postJson(
    apiUrl,
    { Authorization: headers.Authorization },
    {
      using: ["urn:ietf:params:jmap:core", capability],
      methodCalls: [
        [
          "MaskedEmail/set",
          {
            accountId,
            create: {
              "keyward-alias": {
                state: "enabled",
                forDomain: config.website || "",
                description: aliasNote(config.website),
              },
            },
          },
          "0",
        ],
      ],
    },
  )
  const responses = jmap.methodResponses as unknown[] | undefined
  const first = Array.isArray(responses?.[0]) ? responses[0] : null
  const result = first?.[1] as Record<string, unknown> | undefined
  const created = result?.created as
    | Record<string, Record<string, unknown>>
    | undefined
  return requireAlias(created?.["keyward-alias"]?.email, "Fastmail")
}

async function createFirefoxRelay(config: ForwardingConfig): Promise<string> {
  const body = await postJson(
    "https://relay.firefox.com/api/v1/relayaddresses/",
    { Authorization: `Token ${config.apiKey}` },
    {
      enabled: true,
      generated_for: config.website || "",
      description: config.website || "",
    },
  )
  return requireAlias(body.full_address, "Firefox Relay")
}

async function createDuckDuckGo(config: ForwardingConfig): Promise<string> {
  const body = await postJson(
    "https://quack.duckduckgo.com/api/email/addresses",
    { Authorization: `Bearer ${config.apiKey}` },
  )
  const address = requireAlias(body.address, "DuckDuckGo")
  return address.includes("@") ? address : `${address}@duck.com`
}

async function createForwardEmail(config: ForwardingConfig): Promise<string> {
  const domain = requireDomain(config, "ForwardEmail")
  const localPart = randomAliasLocalPart(10)
  const body = await postJson(
    `https://api.forwardemail.net/v1/domains/${encodeURIComponent(domain)}/aliases`,
    { Authorization: `Basic ${btoa(`${config.apiKey}:`)}` },
    { name: localPart, description: aliasNote(config.website) },
  )
  const name =
    typeof body.name === "string" && body.name ? body.name : localPart
  return name.includes("@") ? name : `${name}@${domain}`
}

const FORWARDING_HANDLERS: Record<
  ForwardingService,
  (config: ForwardingConfig) => Promise<string>
> = {
  simplelogin: createSimpleLogin,
  addyio: createAddyIo,
  fastmail: createFastmail,
  firefoxRelay: createFirefoxRelay,
  duckduckgo: createDuckDuckGo,
  forwardEmail: createForwardEmail,
}

/** Creates one forwarded email alias via the user's configured provider API. */
export async function createForwardedAlias(
  config: ForwardingConfig,
): Promise<string> {
  const apiKey = config.apiKey.trim()
  if (!apiKey) throw new VaultError("An API key is required", "invalidInput")
  return FORWARDING_HANDLERS[config.service]({ ...config, apiKey })
}

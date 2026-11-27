import { VaultError } from "./providers/types"

export type ForwardingService =
  | "simplelogin"
  | "addyio"
  | "fastmail"
  | "firefoxRelay"
  | "duckduckgo"
  | "forwardEmail"

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

const DEFAULT_BASE_URLS: Partial<Record<ForwardingService, string>> = {
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
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
    throw new VaultError("Invalid forwarding service URL", "invalidSite")
  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "")
}

function randomAliasLocalPart(length = 10): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")
}

async function fetchJson(
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

async function createSimpleLogin(config: ForwardingConfig): Promise<string> {
  const base = normalizedBaseUrl("simplelogin", config.baseUrl)
  const query = config.website
    ? `?hostname=${encodeURIComponent(config.website)}`
    : ""
  const body = await fetchJson(`${base}/api/alias/random/new${query}`, {
    method: "POST",
    headers: {
      Authentication: config.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      note: config.website ? `Generated for ${config.website}` : "",
    }),
  })
  const email = body.email
  if (typeof email !== "string" || !email)
    throw new VaultError("SimpleLogin returned no alias", "network")
  return email
}

async function createAddyIo(config: ForwardingConfig): Promise<string> {
  const base = normalizedBaseUrl("addyio", config.baseUrl)
  const domain = config.domain?.trim()
  if (!domain) throw new VaultError("Addy.io requires a domain", "invalidInput")
  const body = await fetchJson(`${base}/api/v1/aliases`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: JSON.stringify({
      domain,
      description: config.website ? `Generated for ${config.website}` : "",
    }),
  })
  const data = body.data as Record<string, unknown> | undefined
  const email = data?.email
  if (typeof email !== "string" || !email)
    throw new VaultError("Addy.io returned no alias", "network")
  return email
}

async function createFastmail(config: ForwardingConfig): Promise<string> {
  const capability = "https://www.fastmail.com/dev/maskedemail"
  const session = await fetchJson("https://api.fastmail.com/jmap/session", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
  })
  const apiUrl = session.apiUrl
  const primaryAccounts = session.primaryAccounts as
    | Record<string, unknown>
    | undefined
  const accountId = primaryAccounts?.[capability]
  if (typeof apiUrl !== "string" || typeof accountId !== "string")
    throw new VaultError(
      "Fastmail session lacked Masked Email access",
      "network",
    )
  const jmap = await fetchJson(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
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
                description: config.website
                  ? `Generated for ${config.website}`
                  : "",
              },
            },
          },
          "0",
        ],
      ],
    }),
  })
  const responses = jmap.methodResponses as unknown[] | undefined
  const first = Array.isArray(responses?.[0]) ? responses[0] : null
  const result = first?.[1] as Record<string, unknown> | undefined
  const created = result?.created as
    | Record<string, Record<string, unknown>>
    | undefined
  const email = created?.["keyward-alias"]?.email
  if (typeof email !== "string" || !email)
    throw new VaultError("Fastmail returned no masked email", "network")
  return email
}

async function createFirefoxRelay(config: ForwardingConfig): Promise<string> {
  const body = await fetchJson(
    "https://relay.firefox.com/api/v1/relayaddresses/",
    {
      method: "POST",
      headers: {
        Authorization: `Token ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        enabled: true,
        generated_for: config.website || "",
        description: config.website || "",
      }),
    },
  )
  const email = body.full_address
  if (typeof email !== "string" || !email)
    throw new VaultError("Firefox Relay returned no alias", "network")
  return email
}

async function createDuckDuckGo(config: ForwardingConfig): Promise<string> {
  const body = await fetchJson(
    "https://quack.duckduckgo.com/api/email/addresses",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
    },
  )
  const address = body.address
  if (typeof address !== "string" || !address)
    throw new VaultError("DuckDuckGo returned no alias", "network")
  return address.includes("@") ? address : `${address}@duck.com`
}

async function createForwardEmail(config: ForwardingConfig): Promise<string> {
  const domain = config.domain?.trim()
  if (!domain)
    throw new VaultError("ForwardEmail requires a domain", "invalidInput")
  const localPart = randomAliasLocalPart(10)
  const auth = btoa(`${config.apiKey}:`)
  const body = await fetchJson(
    `https://api.forwardemail.net/v1/domains/${encodeURIComponent(domain)}/aliases`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: localPart,
        description: config.website ? `Generated for ${config.website}` : "",
      }),
    },
  )
  const name =
    typeof body.name === "string" && body.name ? body.name : localPart
  return name.includes("@") ? name : `${name}@${domain}`
}

/** Creates one forwarded email alias via the user's configured provider API. */
export async function createForwardedAlias(
  config: ForwardingConfig,
): Promise<string> {
  const apiKey = config.apiKey.trim()
  if (!apiKey) throw new VaultError("An API key is required", "invalidInput")
  const normalized: ForwardingConfig = { ...config, apiKey }
  switch (normalized.service) {
    case "simplelogin":
      return createSimpleLogin(normalized)
    case "addyio":
      return createAddyIo(normalized)
    case "fastmail":
      return createFastmail(normalized)
    case "firefoxRelay":
      return createFirefoxRelay(normalized)
    case "duckduckgo":
      return createDuckDuckGo(normalized)
    case "forwardEmail":
      return createForwardEmail(normalized)
  }
}

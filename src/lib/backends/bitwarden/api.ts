import type { KdfConfig } from "./crypto"
import type { ServerUrls } from "./server"

/**
 * The server only issues tokens to its built-in client IDs and checks the client headers, so the
 * extension identifies itself as the official browser extension on Chrome.
 */
const CLIENT_ID = "browser"
const CLIENT_VERSION = "2026.11.0"
const DEVICE_TYPE_CHROME_EXTENSION = 2
const NEW_DEVICE_VERIFICATION_REQUIRED = "new device verification required"

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown> | null,
  ) {
    super(apiErrorMessage(status, body))
  }

  /** The refresh token or access token is no longer accepted. */
  get isAuthError(): boolean {
    return (
      this.status === 401 ||
      (this.status === 400 && prop(this.body, "error") === "invalid_grant")
    )
  }
}

function apiErrorMessage(
  status: number,
  body: Record<string, unknown> | null,
): string {
  const text =
    prop(pick(body, "ErrorModel"), "Message") ??
    prop(body, "error_description") ??
    prop(body, "message") ??
    prop(body, "error")
  return typeof text === "string" && text
    ? text
    : `Server responded with status ${status}`
}

/** Reads a property of a server response, which uses PascalCase or camelCase depending on the endpoint. */
export function prop(object: unknown, name: string): unknown {
  if (!object || typeof object !== "object") return undefined
  const record = object as Record<string, unknown>
  if (name in record) return record[name]
  const lower = name.toLowerCase()
  const key = Object.keys(record).find((k) => k.toLowerCase() === lower)
  return key === undefined ? undefined : record[key]
}

export function pick(
  object: unknown,
  name: string,
): Record<string, unknown> | undefined {
  const value = prop(object, name)
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined
}

export interface Device {
  identifier: string
  name: string
}

export type TokenResult =
  | { kind: "token"; body: Record<string, unknown> }
  | { kind: "twoFactor"; providers: number[] }
  /** The server wants a code mailed to the account before it trusts a new device. */
  | { kind: "deviceVerification" }

export type SecondFactor =
  | { kind: "twoFactor"; provider: number; token: string }
  | { kind: "deviceVerification"; code: string }

export class BitwardenApi {
  constructor(private readonly urls: ServerUrls) {}

  private async send(
    url: string,
    init: RequestInit & { accessToken?: string } = {},
  ): Promise<Response> {
    const headers = new Headers({
      Accept: "application/json",
      "Bitwarden-Client-Name": CLIENT_ID,
      "Bitwarden-Client-Version": CLIENT_VERSION,
      "Device-Type": String(DEVICE_TYPE_CHROME_EXTENSION),
    })
    new Headers(init.headers).forEach((value, key) => {
      headers.set(key, value)
    })
    if (init.accessToken)
      headers.set("Authorization", `Bearer ${init.accessToken}`)
    const { accessToken: _token, ...rest } = init
    return fetch(url, {
      ...rest,
      headers,
      cache: "no-store",
      credentials: "omit",
    })
  }

  private async json(
    response: Response,
  ): Promise<Record<string, unknown> | null> {
    const type = response.headers.get("content-type") ?? ""
    if (!type.includes("json")) return null
    return (await response.json()) as Record<string, unknown>
  }

  private async expectJson(
    response: Response,
  ): Promise<Record<string, unknown>> {
    const body = await this.json(response)
    if (!response.ok || !body) throw new ApiError(response.status, body)
    return body
  }

  /** KDF settings and salt of an account, asked before the password is sent. */
  async prelogin(
    email: string,
  ): Promise<{ kdf: KdfConfig; salt: string | null }> {
    const init = {
      method: "POST",
      body: JSON.stringify({ email }),
      headers: { "Content-Type": "application/json" },
    }
    const current = await this.send(
      `${this.urls.identity}/accounts/prelogin/password`,
      init,
    )
    if (current.ok) {
      const json = await this.expectJson(current)
      const settings = pick(json, "KdfSettings")
      const salt = prop(json, "Salt")
      return {
        kdf: {
          type: Number(prop(settings, "KdfType")),
          iterations: Number(prop(settings, "Iterations")),
          memory: optionalNumber(prop(settings, "Memory")),
          parallelism: optionalNumber(prop(settings, "Parallelism")),
        },
        salt: typeof salt === "string" ? salt : null,
      }
    }
    // Servers that predate the endpoint above, including Vaultwarden, only have this one.
    const legacy = await this.expectJson(
      await this.send(`${this.urls.identity}/accounts/prelogin`, init),
    )
    return {
      kdf: {
        type: Number(prop(legacy, "Kdf")),
        iterations: Number(prop(legacy, "KdfIterations")),
        memory: optionalNumber(prop(legacy, "KdfMemory")),
        parallelism: optionalNumber(prop(legacy, "KdfParallelism")),
      },
      salt: null,
    }
  }

  async passwordToken(
    login: { email: string; passwordHash: string },
    device: Device,
    second?: SecondFactor,
  ): Promise<TokenResult> {
    const form = new URLSearchParams({
      grant_type: "password",
      username: login.email,
      password: login.passwordHash,
      scope: "api offline_access",
      client_id: CLIENT_ID,
      deviceType: String(DEVICE_TYPE_CHROME_EXTENSION),
      deviceIdentifier: device.identifier,
      deviceName: device.name,
    })
    if (second?.kind === "twoFactor") {
      form.set("twoFactorToken", second.token)
      form.set("twoFactorProvider", String(second.provider))
      form.set("twoFactorRemember", "0")
    } else if (second?.kind === "deviceVerification") {
      form.set("newDeviceOtp", second.code)
    }
    const response = await this.send(`${this.urls.identity}/connect/token`, {
      method: "POST",
      body: form,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
        "Auth-Email": base64Url(login.email),
      },
    })
    const body = await this.json(response)
    if (response.ok && body) return { kind: "token", body }
    if (response.status === 400) {
      const providers = pick(body, "TwoFactorProviders2")
      if (providers && Object.keys(providers).length) {
        return {
          kind: "twoFactor",
          providers: Object.keys(providers).map(Number),
        }
      }
      const message = prop(pick(body, "ErrorModel"), "Message")
      if (
        typeof message === "string" &&
        message.toLowerCase() === NEW_DEVICE_VERIFICATION_REQUIRED
      ) {
        return { kind: "deviceVerification" }
      }
    }
    throw new ApiError(response.status, body)
  }

  async refreshToken(refreshToken: string): Promise<Record<string, unknown>> {
    return this.expectJson(
      await this.send(`${this.urls.identity}/connect/token`, {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: CLIENT_ID,
          refresh_token: refreshToken,
        }),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
        },
      }),
    )
  }

  /** Asks the server to email a sign-in code; only needed for the email method. */
  async sendEmailCode(
    login: { email: string; passwordHash: string },
    device: Device,
  ): Promise<void> {
    const response = await this.send(
      `${this.urls.api}/two-factor/send-email-login`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          email: login.email,
          masterPasswordHash: login.passwordHash,
          deviceIdentifier: device.identifier,
          authRequestId: null,
        }),
      },
    )
    if (!response.ok)
      throw new ApiError(response.status, await this.json(response))
  }

  async sync(accessToken: string): Promise<Record<string, unknown>> {
    return this.expectJson(
      await this.send(`${this.urls.api}/sync?excludeDomains=true`, {
        accessToken,
      }),
    )
  }

  async createCipher(
    accessToken: string,
    cipher: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.expectJson(
      await this.send(`${this.urls.api}/ciphers`, {
        method: "POST",
        accessToken,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(cipher),
      }),
    )
  }

  async updateCipher(
    accessToken: string,
    id: string,
    cipher: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.expectJson(
      await this.send(`${this.urls.api}/ciphers/${encodeURIComponent(id)}`, {
        method: "PUT",
        accessToken,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(cipher),
      }),
    )
  }
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined
}

function base64Url(text: string): string {
  return new TextEncoder()
    .encode(text)
    .toBase64({ alphabet: "base64url", omitPadding: true })
}

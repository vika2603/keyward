import { VaultError } from "../types"
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

/** The server answered with an error; one about the account's tokens or sign-in is an auth error. */
export class ApiError extends VaultError {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown> | null,
  ) {
    super(
      apiErrorMessage(status, body),
      isAuthReply(status, body) ? "bitwarden.auth" : "bitwarden.api",
    )
  }

  /** The refresh token or access token is no longer accepted. */
  get isAuthError(): boolean {
    return this.code === "bitwarden.auth"
  }
}

function isAuthReply(
  status: number,
  body: Record<string, unknown> | null,
): boolean {
  return (
    status === 401 ||
    (status === 400 && valueAt(body, "error") === "invalid_grant")
  )
}

/** The server could not be reached: no network, a refused connection or an address that does not answer. */
export class NetworkError extends VaultError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, "network", options)
  }
}

function apiErrorMessage(
  status: number,
  body: Record<string, unknown> | null,
): string {
  const text =
    valueAt(objectAt(body, "ErrorModel"), "Message") ??
    valueAt(body, "error_description") ??
    valueAt(body, "message") ??
    valueAt(body, "error")
  return typeof text === "string" && text
    ? text
    : `Server responded with status ${status}`
}

/** Reads a property of a server response, which uses PascalCase or camelCase depending on the endpoint. */
export function valueAt(object: unknown, name: string): unknown {
  if (!object || typeof object !== "object") return undefined
  const record = object as Record<string, unknown>
  if (name in record) return record[name]
  const lower = name.toLowerCase()
  const key = Object.keys(record).find(
    (candidate) => candidate.toLowerCase() === lower,
  )
  return key === undefined ? undefined : record[key]
}

/** A list in a response, or an empty one when the response has none there. */
export function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** A nested object of a server response, or undefined when there is none at that name. */
export function objectAt(
  object: unknown,
  name: string,
): Record<string, unknown> | undefined {
  const value = valueAt(object, name)
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
    try {
      return await fetch(url, {
        ...rest,
        headers,
        cache: "no-store",
        credentials: "omit",
      })
    } catch (error) {
      throw new NetworkError("The server could not be reached", {
        cause: error,
      })
    }
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

  private async sendJson(
    url: string,
    init?: RequestInit & { accessToken?: string },
  ): Promise<Record<string, unknown>> {
    return this.expectJson(await this.send(url, init))
  }

  private async sendVoid(
    url: string,
    init?: RequestInit & { accessToken?: string },
  ): Promise<void> {
    const response = await this.send(url, init)
    if (!response.ok)
      throw new ApiError(
        response.status,
        await this.json(response).catch(() => null),
      )
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
      const settings = objectAt(json, "KdfSettings")
      const salt = valueAt(json, "Salt")
      return {
        kdf: {
          type: Number(valueAt(settings, "KdfType")),
          iterations: Number(valueAt(settings, "Iterations")),
          memory: optionalNumber(valueAt(settings, "Memory")),
          parallelism: optionalNumber(valueAt(settings, "Parallelism")),
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
        type: Number(valueAt(legacy, "Kdf")),
        iterations: Number(valueAt(legacy, "KdfIterations")),
        memory: optionalNumber(valueAt(legacy, "KdfMemory")),
        parallelism: optionalNumber(valueAt(legacy, "KdfParallelism")),
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
      const providers = objectAt(body, "TwoFactorProviders2")
      if (providers && Object.keys(providers).length) {
        return {
          kind: "twoFactor",
          providers: Object.keys(providers).map(Number),
        }
      }
      const message = valueAt(objectAt(body, "ErrorModel"), "Message")
      if (
        typeof message === "string" &&
        message.toLowerCase() === NEW_DEVICE_VERIFICATION_REQUIRED
      ) {
        return { kind: "deviceVerification" }
      }
    }
    throw new ApiError(response.status, body)
  }

  refreshToken(refreshToken: string): Promise<Record<string, unknown>> {
    return this.sendJson(`${this.urls.identity}/connect/token`, {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: CLIENT_ID,
        refresh_token: refreshToken,
      }),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
      },
    })
  }

  /** Asks the server to email a sign-in code; only needed for the email method. */
  sendEmailCode(
    login: { email: string; passwordHash: string },
    device: Device,
  ): Promise<void> {
    return this.sendVoid(`${this.urls.api}/two-factor/send-email-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        email: login.email,
        masterPasswordHash: login.passwordHash,
        deviceIdentifier: device.identifier,
        authRequestId: null,
      }),
    })
  }

  sync(accessToken: string): Promise<Record<string, unknown>> {
    return this.sendJson(`${this.urls.api}/sync`, { accessToken })
  }

  /** Lightweight revision timestamp for checking whether the vault changed before doing a full sync. */
  async revisionDate(accessToken: string): Promise<number | null> {
    const response = await this.send(
      `${this.urls.api}/accounts/revision-date`,
      { accessToken },
    )
    if (!response.ok)
      throw new ApiError(response.status, await this.json(response))
    const raw = (await response.text()).trim()
    if (!raw || raw === "null") return null
    const parsed = Number(raw.replace(/^"|"$/g, ""))
    if (Number.isFinite(parsed) && parsed > 0) return parsed
    const date = Date.parse(raw.replace(/^"|"$/g, ""))
    return Number.isNaN(date) ? null : date
  }

  createCipher(
    accessToken: string,
    cipher: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.sendJson(`${this.urls.api}/ciphers`, {
      method: "POST",
      accessToken,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(cipher),
    })
  }

  /** Creates a cipher owned by an organization and assigned to one or more collections. */
  createOrganizationCipher(
    accessToken: string,
    cipher: Record<string, unknown>,
    collectionIds: string[],
  ): Promise<Record<string, unknown>> {
    return this.sendJson(`${this.urls.api}/ciphers/create`, {
      method: "POST",
      accessToken,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ cipher, collectionIds }),
    })
  }

  updateCipher(
    accessToken: string,
    id: string,
    cipher: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.sendJson(`${this.urls.api}/ciphers/${encodeURIComponent(id)}`, {
      method: "PUT",
      accessToken,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(cipher),
    })
  }

  /**
   * Sets the parts of an item that belong to the user rather than to the item: its folder and
   * whether it is a favorite. Read-only items of an organization take these too.
   */
  updateCipherPartial(
    accessToken: string,
    id: string,
    change: { folderId: string | null; favorite: boolean },
  ): Promise<Record<string, unknown>> {
    return this.sendJson(
      `${this.urls.api}/ciphers/${encodeURIComponent(id)}/partial`,
      {
        method: "PUT",
        accessToken,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(change),
      },
    )
  }

  /** Takes an item out of the trash. */
  restoreCipher(
    accessToken: string,
    id: string,
  ): Promise<Record<string, unknown>> {
    return this.sendJson(
      `${this.urls.api}/ciphers/${encodeURIComponent(id)}/restore`,
      { method: "PUT", accessToken },
    )
  }

  /** Deletes an item for good; the server answers without a body. */
  deleteCipher(accessToken: string, id: string): Promise<void> {
    return this.sendVoid(`${this.urls.api}/ciphers/${encodeURIComponent(id)}`, {
      method: "DELETE",
      accessToken,
    })
  }

  /** Moves an item to the trash; the server answers without a body. */
  trashCipher(accessToken: string, id: string): Promise<void> {
    return this.sendVoid(
      `${this.urls.api}/ciphers/${encodeURIComponent(id)}/delete`,
      { method: "PUT", accessToken },
    )
  }

  /** Moves an item to the archive. */
  archiveCipher(
    accessToken: string,
    id: string,
  ): Promise<Record<string, unknown>> {
    return this.sendJson(
      `${this.urls.api}/ciphers/${encodeURIComponent(id)}/archive`,
      { method: "PUT", accessToken },
    )
  }

  /** Restores an item from the archive back to the active vault. */
  unarchiveCipher(
    accessToken: string,
    id: string,
  ): Promise<Record<string, unknown>> {
    return this.sendJson(
      `${this.urls.api}/ciphers/${encodeURIComponent(id)}/unarchive`,
      { method: "PUT", accessToken },
    )
  }

  createFolder(
    accessToken: string,
    name: string,
  ): Promise<Record<string, unknown>> {
    return this.sendJson(`${this.urls.api}/folders`, {
      method: "POST",
      accessToken,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ name }),
    })
  }

  updateFolder(
    accessToken: string,
    id: string,
    name: string,
  ): Promise<Record<string, unknown>> {
    return this.sendJson(`${this.urls.api}/folders/${encodeURIComponent(id)}`, {
      method: "PUT",
      accessToken,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ name }),
    })
  }

  deleteFolder(accessToken: string, id: string): Promise<void> {
    return this.sendVoid(`${this.urls.api}/folders/${encodeURIComponent(id)}`, {
      method: "DELETE",
      accessToken,
    })
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

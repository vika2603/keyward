import {
  type BitwardenApi,
  type Device,
  pick,
  prop,
  type SecondFactor,
} from "./api"
import {
  type KdfConfig,
  masterKeySalt,
  masterPasswordHash,
  stretchMasterKey,
  type VaultCrypto,
} from "./crypto"

/**
 * Second sign-in steps that can be completed with a typed code. WebAuthn, Duo and SSO need the
 * official web pages and are not offered.
 */
export type SecondStepMethod =
  | "authenticator"
  | "email"
  | "recoveryCode"
  | "newDevice"

const PROVIDER_OF: Record<Exclude<SecondStepMethod, "newDevice">, number> = {
  authenticator: 0,
  email: 1,
  recoveryCode: 8,
}

export function methodsFromProviders(providers: number[]): SecondStepMethod[] {
  const methods: SecondStepMethod[] = []
  if (providers.includes(PROVIDER_OF.authenticator))
    methods.push("authenticator")
  if (providers.includes(PROVIDER_OF.email)) methods.push("email")
  // A recovery code is accepted whenever another method is configured.
  if (providers.length) methods.push("recoveryCode")
  return methods
}

export function secondFactor(
  method: SecondStepMethod,
  code: string,
): SecondFactor {
  const token = code.replace(/\s/g, "")
  if (method === "newDevice") return { kind: "deviceVerification", code: token }
  return { kind: "twoFactor", provider: PROVIDER_OF[method], token }
}

/** What a sign-in keeps between the password step and the second step, in storage.session. */
export interface PendingLogin {
  email: string
  passwordHash: string
  masterKey: string
  kdf: KdfConfig
  salt: string
  methods: SecondStepMethod[]
}

export interface SignedIn {
  email: string
  masterKey: Uint8Array<ArrayBuffer>
  kdf: KdfConfig
  salt: string
  token: Record<string, unknown>
}

export type LoginStep =
  | { kind: "signedIn"; result: SignedIn }
  | { kind: "secondStep"; pending: PendingLogin }

export async function signIn(
  api: BitwardenApi,
  vault: VaultCrypto,
  device: Device,
  credentials: { email: string; password: string },
): Promise<LoginStep> {
  const email = credentials.email.trim()
  const prelogin = await api.prelogin(email)
  const salt = masterKeySalt(email, prelogin.salt)
  const masterKey = vault.deriveMasterKey(
    credentials.password,
    salt,
    prelogin.kdf,
  )
  const passwordHash = await masterPasswordHash(masterKey, credentials.password)
  const result = await api.passwordToken({ email, passwordHash }, device)
  if (result.kind === "token") {
    return {
      kind: "signedIn",
      result: { email, masterKey, kdf: prelogin.kdf, salt, token: result.body },
    }
  }
  const methods: SecondStepMethod[] =
    result.kind === "twoFactor"
      ? methodsFromProviders(result.providers)
      : ["newDevice"]
  if (!methods.length)
    throw new Error(
      "The account needs a two-step method this extension does not support",
    )
  return {
    kind: "secondStep",
    pending: {
      email,
      passwordHash,
      masterKey: masterKey.toBase64(),
      kdf: prelogin.kdf,
      salt,
      methods,
    },
  }
}

export async function completeSecondStep(
  api: BitwardenApi,
  device: Device,
  pending: PendingLogin,
  method: SecondStepMethod,
  code: string,
): Promise<SignedIn> {
  const result = await api.passwordToken(
    { email: pending.email, passwordHash: pending.passwordHash },
    device,
    secondFactor(method, code),
  )
  if (result.kind !== "token") throw new Error("The code was not accepted")
  return {
    email: pending.email,
    masterKey: Uint8Array.fromBase64(pending.masterKey),
    kdf: pending.kdf,
    salt: pending.salt,
    token: result.body,
  }
}

/** The master-key-wrapped user key of a token response. */
export function wrappedUserKeyOf(token: Record<string, unknown>): string {
  const unlock = pick(
    pick(token, "UserDecryptionOptions"),
    "MasterPasswordUnlock",
  )
  const key = prop(unlock, "MasterKeyEncryptedUserKey") ?? prop(token, "Key")
  if (typeof key !== "string") throw new Error("The server sent no account key")
  return key
}

export async function unwrapUserKey(
  vault: VaultCrypto,
  wrappedUserKey: string,
  masterKey: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array> {
  return vault.unwrapUserKey(wrappedUserKey, await stretchMasterKey(masterKey))
}

/** The user ID is the `sub` claim of the access token. */
export function userIdOf(accessToken: string): string {
  const payload = accessToken.split(".")[1]
  if (!payload) throw new Error("Malformed access token")
  const claims = JSON.parse(
    new TextDecoder().decode(
      Uint8Array.fromBase64(payload, { alphabet: "base64url" }),
    ),
  )
  if (typeof claims.sub !== "string")
    throw new Error("Access token has no user ID")
  return claims.sub
}

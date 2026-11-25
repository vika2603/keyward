import { storage } from "wxt/utils/storage"
import { VaultError } from "../types"
import { deviceIdentifier } from "./account-store"
import { BitwardenApi, type Device } from "./api"
import {
  completeSecondStep,
  type PendingLogin,
  type SecondStepMethod,
  type SignedIn,
  signIn,
} from "./auth"
import type { VaultCrypto } from "./crypto"
import { type CustomEndpoints, serverUrls } from "./server"

export interface PendingSignInView {
  server: string
  endpoints?: CustomEndpoints
  email: string
  methods: SecondStepMethod[]
}

export type SignInOutcome =
  | { kind: "signedIn"; accountId: string }
  | { kind: "secondStep"; pending: PendingSignInView }

/** A sign-in waiting for its second step; kept in storage.session so the popup can close meanwhile. */
interface PendingSignIn {
  server: string
  endpoints?: CustomEndpoints
  login: PendingLogin
}

const pendingItem = storage.defineItem<PendingSignIn>(
  "session:bitwarden.pendingLogin",
)

function pendingView(pending: PendingSignIn): PendingSignInView {
  return {
    server: pending.server,
    endpoints: pending.endpoints,
    email: pending.login.email,
    methods: pending.login.methods,
  }
}

async function device(): Promise<Device> {
  return { identifier: await deviceIdentifier(), name: "chrome" }
}

/**
 * Signing in to an account: the master password, then a second step when the account has one.
 * `finish` stores the signed-in account and returns its ID.
 */
export class SignInFlow {
  constructor(
    private readonly loadCrypto: () => Promise<VaultCrypto>,
    private readonly finish: (
      server: string,
      endpoints: CustomEndpoints | undefined,
      signedIn: SignedIn,
    ) => Promise<string>,
  ) {}

  async signIn(
    server: string,
    credentials: { email: string; password: string },
    endpoints?: CustomEndpoints,
  ): Promise<SignInOutcome> {
    await pendingItem.removeValue()
    const step = await signIn(
      new BitwardenApi(serverUrls(server, endpoints)),
      await this.loadCrypto(),
      await device(),
      credentials,
    )
    if (step.kind === "secondStep") {
      const pending: PendingSignIn = { server, endpoints, login: step.pending }
      await pendingItem.setValue(pending)
      return { kind: "secondStep", pending: pendingView(pending) }
    }
    return {
      kind: "signedIn",
      accountId: await this.finish(server, endpoints, step.result),
    }
  }

  async pendingSignIn(): Promise<PendingSignInView | null> {
    const pending = await pendingItem.getValue()
    return pending ? pendingView(pending) : null
  }

  async cancelSignIn(): Promise<void> {
    await pendingItem.removeValue()
  }

  private async requirePending(): Promise<PendingSignIn> {
    const pending = await pendingItem.getValue()
    if (!pending)
      throw new VaultError(
        "No sign-in is waiting for a code",
        "bitwarden.noPendingSignIn",
      )
    return pending
  }

  async sendEmailCode(): Promise<void> {
    const { server, endpoints, login } = await this.requirePending()
    await new BitwardenApi(serverUrls(server, endpoints)).sendEmailCode(
      { email: login.email, passwordHash: login.passwordHash },
      await device(),
    )
  }

  async submitSecondStep(
    method: SecondStepMethod,
    code: string,
  ): Promise<string> {
    const pending = await this.requirePending()
    if (!pending.login.methods.includes(method))
      throw new VaultError("Unsupported method", "bitwarden.method")
    const signedIn = await completeSecondStep(
      new BitwardenApi(serverUrls(pending.server, pending.endpoints)),
      await device(),
      pending.login,
      method,
      code,
    )
    await pendingItem.removeValue()
    return this.finish(pending.server, pending.endpoints, signedIn)
  }
}

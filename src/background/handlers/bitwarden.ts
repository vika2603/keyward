import type { Handlers } from "@/lib/messaging"
import type {
  AccountSummary,
  BitwardenProvider,
} from "@/lib/providers/bitwarden/bitwarden-provider"
import { normalizeServerAddress } from "@/lib/providers/bitwarden/server"
import { VaultError } from "@/lib/providers/types"
import type { BackgroundApi } from "../api"
import { MAX_ACCOUNT_NAME_LENGTH, MAX_SECOND_STEP_CODE_LENGTH } from "../limits"
import { connectPages } from "./request-context"
import { customEndpointsOf, requireText, secondStepMethod } from "./validation"

export function bitwardenHandlers(bitwarden: BitwardenProvider) {
  const knownAccount = async (accountId: unknown): Promise<AccountSummary> => {
    const checkedId = requireText(accountId, "accountId")
    const account = (await bitwarden.accounts()).find(
      (candidate) => candidate.id === checkedId,
    )
    if (!account) throw new VaultError("Unknown account", "unknownVault")
    return account
  }

  return {
    "bitwarden.accounts": {
      allow: connectPages,
      handle: () => bitwarden.accounts(),
    },
    "bitwarden.unlock": {
      allow: connectPages,
      handle: async ({ accountId, password }) => {
        await bitwarden.unlock(
          requireText(accountId, "accountId"),
          requireText(password, "password"),
        )
        return null
      },
    },
    "bitwarden.signOut": {
      allow: ["options"],
      handle: async ({ accountId }) => {
        await bitwarden.signOut(requireText(accountId, "accountId"))
        return null
      },
    },
    "bitwarden.sync": {
      allow: ["options"],
      handle: async ({ accountId }) => {
        const account = await knownAccount(accountId)
        if (!account.unlocked) throw new VaultError("Locked", "locked")
        await bitwarden.sync(account.id)
        return null
      },
    },
    "bitwarden.renameAccount": {
      allow: ["options"],
      handle: async ({ accountId, name }) => {
        const account = await knownAccount(accountId)
        await bitwarden.renameAccount(
          account.id,
          requireText(name, "name", MAX_ACCOUNT_NAME_LENGTH),
        )
        return null
      },
    },
    "bitwarden.signIn": {
      allow: connectPages,
      handle: ({ server, endpoints, email, password }) =>
        bitwarden.signIn(
          normalizeServerAddress(requireText(server, "server")),
          {
            email: requireText(email, "email").trim(),
            password: requireText(password, "password"),
          },
          customEndpointsOf(endpoints),
        ),
    },
    "bitwarden.pendingSignIn": {
      allow: connectPages,
      handle: () => bitwarden.pendingSignIn(),
    },
    "bitwarden.sendEmailCode": {
      allow: connectPages,
      handle: async () => {
        await bitwarden.sendEmailCode()
        return null
      },
    },
    "bitwarden.submitSecondStep": {
      allow: connectPages,
      handle: async ({ method, code }) => ({
        accountId: await bitwarden.submitSecondStep(
          secondStepMethod(method),
          requireText(code, "code", MAX_SECOND_STEP_CODE_LENGTH),
        ),
      }),
    },
    "bitwarden.cancelSignIn": {
      allow: connectPages,
      handle: async () => {
        await bitwarden.cancelSignIn()
        return null
      },
    },
  } satisfies Partial<Handlers<BackgroundApi>>
}

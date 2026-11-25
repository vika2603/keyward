import type { Handlers } from "@/lib/messaging"
import { normalizeServerAddress } from "@/lib/providers/bitwarden/server"
import { VaultError } from "@/lib/providers/types"
import type { BackgroundApi } from "../api"
import type { Providers } from "../providers"
import { connectPages } from "./request-context"
import { customEndpointsOf, requireText } from "./validation"

export function bitwardenHandlers(providers: Providers) {
  const { bitwarden } = providers
  return {
    "bitwarden.accounts": {
      allow: connectPages,
      handle: () => bitwarden.accounts(),
    },
    "bitwarden.unlock": {
      allow: connectPages,
      handle: async ({ accountId, password }) => {
        await bitwarden.unlock(accountId, requireText(password, "password"))
        return null
      },
    },
    "bitwarden.signOut": {
      allow: ["options"],
      handle: async ({ accountId }) => {
        await bitwarden.signOut(accountId)
        return null
      },
    },
    "bitwarden.sync": {
      allow: ["options"],
      handle: async ({ accountId }) => {
        const id = requireText(accountId, "accountId")
        const account = (await bitwarden.accounts()).find(
          (candidate) => candidate.id === id,
        )
        if (!account) throw new VaultError("Unknown account", "unknownVault")
        if (!account.unlocked) throw new VaultError("Locked", "locked")
        await bitwarden.sync(id)
        return null
      },
    },
    "bitwarden.renameAccount": {
      allow: ["options"],
      handle: async ({ accountId, name }) => {
        const id = requireText(accountId, "accountId")
        const known = (await bitwarden.accounts()).some(
          (account) => account.id === id,
        )
        if (!known) throw new VaultError("Unknown account", "unknownVault")
        await bitwarden.renameAccount(id, requireText(name, "name", 100))
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
          method,
          requireText(code, "code", 128),
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

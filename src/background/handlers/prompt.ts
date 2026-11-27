import type { Handlers } from "@/lib/messaging"
import type { BitwardenProvider } from "@/lib/providers/bitwarden/bitwarden-provider"
import type { BackgroundApi } from "../api"
import { promptSessions } from "../overlays"
import { sendToFrame } from "../page"
import type { Providers } from "../providers"
import {
  closePrompt,
  confirmPrompt,
  neverForSite,
  promptFolders,
  promptState,
  unlockAndSavePrompt,
} from "../save-prompt"
import {
  optionalFolderId,
  optionalText,
  requireFiniteNumber,
  requireText,
} from "./validation"

export function promptHandlers(
  providers: Providers,
  bitwarden: BitwardenProvider,
) {
  return {
    "prompt.state": {
      allow: ["savePrompt"],
      handle: async ({ token }, sender) =>
        promptState(providers, await promptSessions.claim(sender, token)),
    },
    "prompt.confirm": {
      allow: ["savePrompt"],
      handle: async (
        { token, targetId, username, password, name, folderId },
        sender,
      ) => {
        await confirmPrompt(
          providers,
          await promptSessions.claim(sender, token),
          optionalText(targetId, "targetId"),
          {
            username: optionalText(username, "username") ?? undefined,
            password: optionalText(password, "password") ?? undefined,
            name: requireText(name ?? "", "name"),
            folderId: optionalFolderId(folderId),
          },
        )
        return null
      },
    },
    "prompt.unlockAndSave": {
      allow: ["savePrompt"],
      handle: async (
        { token, vaultId, masterPassword, username, password, name },
        sender,
      ) =>
        unlockAndSavePrompt(
          providers,
          bitwarden,
          await promptSessions.claim(sender, token),
          {
            vaultId: requireText(vaultId, "vaultId"),
            masterPassword:
              optionalText(masterPassword, "masterPassword") ?? undefined,
            username: optionalText(username, "username") ?? undefined,
            password: optionalText(password, "password") ?? undefined,
            name: requireText(name ?? "", "name"),
          },
        ),
    },
    "prompt.folders": {
      allow: ["savePrompt"],
      handle: async ({ token, vaultId }, sender) =>
        promptFolders(
          providers,
          await promptSessions.claim(sender, token),
          requireText(vaultId, "vaultId"),
        ),
    },
    "prompt.never": {
      allow: ["savePrompt"],
      handle: async ({ token }, sender) => {
        await neverForSite(await promptSessions.claim(sender, token))
        return null
      },
    },
    "prompt.close": {
      allow: ["savePrompt"],
      handle: async ({ token }, sender) => {
        await closePrompt((await promptSessions.claim(sender, token)).tabId)
        return null
      },
    },
    "prompt.resize": {
      allow: ["savePrompt"],
      handle: async ({ token, height }, sender) => {
        const session = await promptSessions.claim(sender, token)
        await sendToFrame(session.tabId, session.frameId, {
          type: "prompt.resize",
          height: requireFiniteNumber(height, "height"),
        })
        return null
      },
    },
  } satisfies Partial<Handlers<BackgroundApi>>
}

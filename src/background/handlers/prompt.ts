import type { Handlers } from "@/lib/messaging"
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
} from "../save-prompt"
import {
  optionalFolderId,
  optionalText,
  requireFiniteNumber,
  requireText,
} from "./validation"

export function promptHandlers(providers: Providers) {
  return {
    "prompt.state": {
      allow: ["savePrompt"],
      handle: async ({ token }, sender) =>
        promptState(providers, await promptSessions.claim(sender, token)),
    },
    "prompt.confirm": {
      allow: ["savePrompt"],
      handle: async ({ token, targetId, name, folderId }, sender) => {
        await confirmPrompt(
          providers,
          await promptSessions.claim(sender, token),
          optionalText(targetId, "targetId"),
          {
            name: requireText(name ?? "", "name"),
            folderId: optionalFolderId(folderId),
          },
        )
        return null
      },
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

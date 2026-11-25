import type { Handlers } from "@/lib/messaging"
import type { BackgroundApi } from "../api"
import { prompts } from "../overlays"
import { sendToFrame } from "../page"
import type { Providers } from "../providers"
import {
  closePrompt,
  confirmPrompt,
  neverForSite,
  promptFolders,
  promptState,
} from "../save-flow"
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
        promptState(providers, (await prompts.claim(sender, token)).tabId),
    },
    "prompt.confirm": {
      allow: ["savePrompt"],
      handle: async ({ token, targetId, name, folderId }, sender) => {
        await confirmPrompt(
          providers,
          (await prompts.claim(sender, token)).tabId,
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
          (await prompts.claim(sender, token)).tabId,
          requireText(vaultId, "vaultId"),
        ),
    },
    "prompt.never": {
      allow: ["savePrompt"],
      handle: async ({ token }, sender) => {
        await neverForSite((await prompts.claim(sender, token)).tabId)
        return null
      },
    },
    "prompt.close": {
      allow: ["savePrompt"],
      handle: async ({ token }, sender) => {
        await closePrompt((await prompts.claim(sender, token)).tabId)
        return null
      },
    },
    "prompt.resize": {
      allow: ["savePrompt"],
      handle: async ({ token, height }, sender) => {
        const session = await prompts.claim(sender, token)
        await sendToFrame(session.tabId, session.frameId, {
          type: "prompt.resize",
          height: requireFiniteNumber(height, "height"),
        })
        return null
      },
    },
  } satisfies Partial<Handlers<BackgroundApi>>
}

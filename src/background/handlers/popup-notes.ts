import type { Handlers } from "@/lib/messaging"
import type { BackgroundApi } from "../api"
import type { Providers } from "../providers"
import { namedVaultWith, noNotes } from "./capabilities"
import { popupOnly } from "./request-context"
import { noteInput, requireText } from "./validation"

export function popupNoteHandlers(providers: Providers) {
  return {
    "popup.note": {
      allow: popupOnly,
      handle: ({ vaultId, noteId }) => {
        const vault = namedVaultWith(providers, vaultId, "note", noNotes)
        return vault.provider.note(vault.vaultId, requireText(noteId, "noteId"))
      },
    },
    "popup.editableNote": {
      allow: popupOnly,
      handle: ({ vaultId, noteId }) => {
        const vault = namedVaultWith(
          providers,
          vaultId,
          "editableNote",
          noNotes,
        )
        return vault.provider.editableNote(
          vault.vaultId,
          requireText(noteId, "noteId"),
        )
      },
    },
    "popup.noteTargets": {
      allow: popupOnly,
      handle: () => providers.noteTargets(),
    },
    "popup.saveNote": {
      allow: popupOnly,
      handle: async ({ vaultId, note }) => {
        const vault = namedVaultWith(providers, vaultId, "saveNote", noNotes)
        await vault.provider.saveNote(vault.vaultId, noteInput(note))
        return null
      },
    },
    "popup.editNote": {
      allow: popupOnly,
      handle: async ({ vaultId, noteId, note }) => {
        const vault = namedVaultWith(providers, vaultId, "editNote", noNotes)
        await vault.provider.editNote(
          vault.vaultId,
          requireText(noteId, "noteId"),
          noteInput(note),
        )
        return null
      },
    },
    "popup.removeNote": {
      allow: popupOnly,
      handle: async ({ vaultId, noteId }) => {
        const vault = namedVaultWith(providers, vaultId, "remove")
        await vault.provider.remove(
          vault.vaultId,
          requireText(noteId, "noteId"),
        )
        return null
      },
    },
  } satisfies Partial<Handlers<BackgroundApi>>
}

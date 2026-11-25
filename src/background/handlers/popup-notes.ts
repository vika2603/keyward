import type { Handlers } from "@/lib/messaging"
import type { BackgroundApi } from "../api"
import type { Providers } from "../providers"
import { noNotes, notEditable } from "./capabilities"
import { popupOnly } from "./request-context"
import { noteInput, requireText } from "./validation"

export function popupNoteHandlers(providers: Providers) {
  return {
    "popup.note": {
      allow: popupOnly,
      handle: ({ vaultId, noteId }) => {
        const provider = providers.providerOf(vaultId)
        if (!provider.note) throw noNotes()
        return provider.note(vaultId, requireText(noteId, "noteId"))
      },
    },
    "popup.editableNote": {
      allow: popupOnly,
      handle: ({ vaultId, noteId }) => {
        const provider = providers.providerOf(vaultId)
        if (!provider.editableNote) throw noNotes()
        return provider.editableNote(vaultId, requireText(noteId, "noteId"))
      },
    },
    "popup.noteTargets": {
      allow: popupOnly,
      handle: () => providers.noteTargets(),
    },
    "popup.saveNote": {
      allow: popupOnly,
      handle: async ({ vaultId, note }) => {
        const provider = providers.providerOf(vaultId)
        if (!provider.saveNote) throw noNotes()
        await provider.saveNote(vaultId, noteInput(note))
        return null
      },
    },
    "popup.editNote": {
      allow: popupOnly,
      handle: async ({ vaultId, noteId, note }) => {
        const provider = providers.providerOf(vaultId)
        if (!provider.editNote) throw noNotes()
        await provider.editNote(
          vaultId,
          requireText(noteId, "noteId"),
          noteInput(note),
        )
        return null
      },
    },
    "popup.removeNote": {
      allow: popupOnly,
      handle: async ({ vaultId, noteId }) => {
        const provider = providers.providerOf(vaultId)
        if (!provider.remove) throw notEditable()
        await provider.remove(vaultId, requireText(noteId, "noteId"))
        return null
      },
    },
  } satisfies Partial<Handlers<BackgroundApi>>
}

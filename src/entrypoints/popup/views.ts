import type { PopupView } from "@/background/api"
import type {
  LoginSummary,
  NoteSummary,
  VaultInfo,
} from "@/lib/providers/types"

/** Present when the opened item lives in the trash rather than the active vault. */
export interface TrashInfo {
  editable: boolean
  deletedAt?: number
}

/** Present when the opened item lives in the archive rather than the active vault. */
export interface ArchiveInfo {
  editable: boolean
  archivedAt?: number
}

/** The popup's views, with what each one shows. */
export type View =
  | PopupView
  | { name: "add" }
  | { name: "history" }
  | { name: "security" }
  | {
      name: "detail"
      vault: VaultInfo
      login: LoginSummary
      trashed?: TrashInfo
      archived?: ArchiveInfo
    }
  | { name: "edit"; vault: VaultInfo; login: LoginSummary }
  | {
      name: "passwordHistory"
      vault: VaultInfo
      login: LoginSummary
      trashed?: TrashInfo
      archived?: ArchiveInfo
    }
  | {
      name: "note"
      vault: VaultInfo
      note: NoteSummary
      trashed?: TrashInfo
      archived?: ArchiveInfo
    }
  | { name: "editNote"; vault: VaultInfo; note: NoteSummary }

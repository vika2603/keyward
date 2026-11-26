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

/** The popup's views, with what each one shows. */
export type View =
  | PopupView
  | { name: "add" }
  | { name: "history" }
  | {
      name: "detail"
      vault: VaultInfo
      login: LoginSummary
      trashed?: TrashInfo
    }
  | { name: "edit"; vault: VaultInfo; login: LoginSummary }
  | {
      name: "passwordHistory"
      vault: VaultInfo
      login: LoginSummary
      trashed?: TrashInfo
    }
  | { name: "note"; vault: VaultInfo; note: NoteSummary; trashed?: TrashInfo }
  | { name: "editNote"; vault: VaultInfo; note: NoteSummary }

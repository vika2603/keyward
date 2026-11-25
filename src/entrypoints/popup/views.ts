import type { PopupView } from "@/background/api"
import type {
  LoginSummary,
  NoteSummary,
  VaultInfo,
} from "@/lib/providers/types"

/** The popup's views, with what each one shows. */
export type View =
  | PopupView
  | { name: "add" }
  | { name: "history" }
  | { name: "detail"; vault: VaultInfo; login: LoginSummary }
  | { name: "edit"; vault: VaultInfo; login: LoginSummary }
  | { name: "passwordHistory"; vault: VaultInfo; login: LoginSummary }
  | { name: "note"; vault: VaultInfo; note: NoteSummary }
  | { name: "editNote"; vault: VaultInfo; note: NoteSummary }

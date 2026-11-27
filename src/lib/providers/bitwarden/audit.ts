import { sha256, utf8 } from "@/lib/bytes"
import {
  changePasswordUrlFor,
  evaluatePasswordStrength,
  isInsecureHttpUri,
  type StrengthScore,
} from "@/lib/security-check"
import type { LoginSummary, VaultInfo } from "../types"
import { valueAt } from "./api"
import { decryptPassword, type LoginItem } from "./decrypt"
import type { Vault } from "./vault-cache"

export interface SecurityAuditFinding {
  vault: VaultInfo
  login: LoginSummary
  score?: StrengthScore
  reuseCount?: number
  changePasswordUrl: string | null
}

export interface SecurityAuditReport {
  weak: SecurityAuditFinding[]
  reused: SecurityAuditFinding[]
  insecureHttp: SecurityAuditFinding[]
  totalChecked: number
}

export interface AuditedVault {
  info: VaultInfo
  vault: Vault
}

/**
 * Audits all unlocked Bitwarden vaults locally for weak, reused, and HTTP-only login passwords.
 * Performs no network requests and skips reprompt-protected items.
 */
export async function runSecurityAudit(
  vaults: readonly AuditedVault[],
  summaryOf: (item: LoginItem) => LoginSummary,
): Promise<SecurityAuditReport> {
  const weak: SecurityAuditFinding[] = []
  const insecureHttp: SecurityAuditFinding[] = []
  const byPasswordDigest = new Map<
    string,
    {
      vault: VaultInfo
      login: LoginSummary
      changePasswordUrl: string | null
    }[]
  >()
  let totalChecked = 0

  for (const { info: vaultInfo, vault } of vaults) {
    const cipherById = ciphersById(vault.ciphers)
    for (const item of vault.items) {
      if (item.reprompt) continue
      const cipher = cipherById.get(item.id)
      if (!cipher) continue
      const summary = summaryOf(item)
      const changePasswordUrl = changePasswordUrlFor(summary.host)
      totalChecked++

      if (item.uris.some(({ uri }) => isInsecureHttpUri(uri))) {
        insecureHttp.push({
          vault: vaultInfo,
          login: summary,
          changePasswordUrl,
        })
      }

      const password = decryptPassword(cipher, vault.keys)
      if (!password) continue
      const strength = evaluatePasswordStrength(password, [
        item.name,
        item.username,
        summary.host ?? "",
      ])
      if (strength.score <= 1) {
        weak.push({
          vault: vaultInfo,
          login: summary,
          score: strength.score,
          changePasswordUrl,
        })
      }
      const digest = (await sha256(utf8(password))).toBase64()
      const group = byPasswordDigest.get(digest) ?? []
      group.push({ vault: vaultInfo, login: summary, changePasswordUrl })
      byPasswordDigest.set(digest, group)
    }
  }

  const reused: SecurityAuditFinding[] = []
  for (const group of byPasswordDigest.values()) {
    if (group.length < 2) continue
    for (const entry of group) {
      reused.push({ ...entry, reuseCount: group.length })
    }
  }

  return { weak, reused, insecureHttp, totalChecked }
}

/** Indexes raw Bitwarden ciphers by their string `Id` for O(1) lookups. */
export function ciphersById(
  ciphers: readonly Record<string, unknown>[],
): Map<string, Record<string, unknown>> {
  return new Map(
    ciphers.map((cipher) => [String(valueAt(cipher, "Id")), cipher]),
  )
}

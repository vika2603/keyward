import { BackendError } from "../types"

const SOURCE_PREFIX = "bitwarden:"

export function sourceIdOf(accountId: string): string {
  return SOURCE_PREFIX + accountId
}

export function isBitwardenSource(sourceId: string): boolean {
  return sourceId.startsWith(SOURCE_PREFIX)
}

export function accountIdOfSource(sourceId: string): string {
  if (!isBitwardenSource(sourceId))
    throw new BackendError("Unknown source", "unknownSource")
  return sourceId.slice(SOURCE_PREFIX.length)
}

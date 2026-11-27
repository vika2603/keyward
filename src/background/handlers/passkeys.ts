import type { Handlers } from "@/lib/messaging"
import type {
  PasskeyCreateRequest,
  PasskeyDescriptor,
  PasskeyGetRequest,
} from "@/lib/passkeys/types"
import { VaultError } from "@/lib/providers/types"
import type { BackgroundApi } from "../api"
import type { PasskeyPrompt } from "../passkey-prompt"
import { tabFrame } from "./request-context"
import { optionalText, requireText } from "./validation"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function parseDescriptors(raw: unknown): PasskeyDescriptor[] {
  if (!Array.isArray(raw)) return []
  const descriptors: PasskeyDescriptor[] = []
  for (const item of raw) {
    if (!isRecord(item) || typeof item.id !== "string" || !item.id) continue
    const transports = Array.isArray(item.transports)
      ? item.transports.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : undefined
    descriptors.push({
      type: "public-key",
      id: item.id,
      ...(transports ? { transports } : {}),
    })
  }
  return descriptors
}

function parseUserVerification(
  raw: unknown,
): "required" | "preferred" | "discouraged" | undefined {
  if (raw === "required" || raw === "preferred" || raw === "discouraged")
    return raw
  return undefined
}

export function parsePasskeyGetRequest(raw: unknown): PasskeyGetRequest {
  if (!isRecord(raw))
    throw new VaultError("Missing passkey request", "invalidInput")
  return {
    rpId: stringOrEmpty(raw.rpId),
    challenge: requireText(raw.challenge, "challenge"),
    allowCredentials: parseDescriptors(raw.allowCredentials),
    userVerification: parseUserVerification(raw.userVerification),
    origin: stringOrEmpty(raw.origin),
    crossOrigin: raw.crossOrigin === true,
  }
}

export function parsePasskeyCreateRequest(raw: unknown): PasskeyCreateRequest {
  if (!isRecord(raw))
    throw new VaultError("Missing passkey creation request", "invalidInput")
  const residentKey =
    raw.residentKey === "discouraged" ||
    raw.residentKey === "preferred" ||
    raw.residentKey === "required"
      ? raw.residentKey
      : undefined
  const pubKeyCredParams = Array.isArray(raw.pubKeyCredParams)
    ? raw.pubKeyCredParams.filter(
        (algorithm): algorithm is number =>
          typeof algorithm === "number" && Number.isSafeInteger(algorithm),
      )
    : []
  return {
    rpId: stringOrEmpty(raw.rpId),
    rpName: stringOrEmpty(raw.rpName),
    challenge: requireText(raw.challenge, "challenge"),
    userId: requireText(raw.userId, "userId"),
    userName: stringOrEmpty(raw.userName),
    userDisplayName: stringOrEmpty(raw.userDisplayName),
    pubKeyCredParams,
    excludeCredentials: parseDescriptors(raw.excludeCredentials),
    residentKey,
    userVerification: parseUserVerification(raw.userVerification),
    origin: stringOrEmpty(raw.origin),
    crossOrigin: raw.crossOrigin === true,
  }
}

export function passkeyHandlers(passkeyPrompt: PasskeyPrompt) {
  return {
    "content.passkeyGet": {
      allow: ["contentScript"],
      handle: ({ requestId, request }, sender) => {
        const { tabId, frameId } = tabFrame(sender)
        return passkeyPrompt.handleGet(
          tabId,
          frameId,
          requireText(requestId, "requestId"),
          parsePasskeyGetRequest(request),
        )
      },
    },
    "content.passkeyCreate": {
      allow: ["contentScript"],
      handle: ({ requestId, request }, sender) => {
        const { tabId, frameId } = tabFrame(sender)
        return passkeyPrompt.handleCreate(
          tabId,
          frameId,
          requireText(requestId, "requestId"),
          parsePasskeyCreateRequest(request),
        )
      },
    },
    "content.passkeyCancel": {
      allow: ["contentScript"],
      handle: ({ requestId }) => {
        passkeyPrompt.cancelRequest(requireText(requestId, "requestId"))
        return null
      },
    },
    "popup.passkey": {
      allow: ["popup"],
      handle: () => passkeyPrompt.view(),
    },
    "popup.answerPasskeyGet": {
      allow: ["popup"],
      handle: async ({ vaultId, loginId, credentialId }) => {
        await passkeyPrompt.choosePasskey(
          requireText(vaultId, "vaultId"),
          requireText(loginId, "loginId"),
          requireText(credentialId, "credentialId"),
        )
        return null
      },
    },
    "popup.answerPasskeyCreate": {
      allow: ["popup"],
      handle: async ({ vaultId, loginId }) => {
        await passkeyPrompt.savePasskey(
          requireText(vaultId, "vaultId"),
          optionalText(loginId, "loginId"),
        )
        return null
      },
    },
    "popup.fallbackPasskey": {
      allow: ["popup"],
      handle: () => {
        passkeyPrompt.fallback()
        return null
      },
    },
    "popup.cancelPasskey": {
      allow: ["popup"],
      handle: () => {
        passkeyPrompt.cancel()
        return null
      },
    },
  } satisfies Partial<Handlers<BackgroundApi>>
}

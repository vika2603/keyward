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

function parseDescriptors(raw: unknown): PasskeyDescriptor[] {
  if (!Array.isArray(raw)) return []
  const result: PasskeyDescriptor[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const rec = item as Record<string, unknown>
    if (typeof rec.id !== "string" || !rec.id) continue
    result.push({
      type: "public-key",
      id: rec.id,
      ...(Array.isArray(rec.transports)
        ? {
            transports: rec.transports.filter(
              (entry): entry is string => typeof entry === "string",
            ),
          }
        : {}),
    })
  }
  return result
}

function parseUserVerification(
  raw: unknown,
): "required" | "preferred" | "discouraged" | undefined {
  return raw === "required" || raw === "preferred" || raw === "discouraged"
    ? raw
    : undefined
}

export function parsePasskeyGetRequest(raw: unknown): PasskeyGetRequest {
  if (!raw || typeof raw !== "object")
    throw new VaultError("Missing passkey request", "invalidInput")
  const rec = raw as Record<string, unknown>
  return {
    rpId: typeof rec.rpId === "string" ? rec.rpId : "",
    challenge: requireText(rec.challenge, "challenge"),
    allowCredentials: parseDescriptors(rec.allowCredentials),
    userVerification: parseUserVerification(rec.userVerification),
    origin: typeof rec.origin === "string" ? rec.origin : "",
    crossOrigin: rec.crossOrigin === true,
  }
}

export function parsePasskeyCreateRequest(raw: unknown): PasskeyCreateRequest {
  if (!raw || typeof raw !== "object")
    throw new VaultError("Missing passkey creation request", "invalidInput")
  const rec = raw as Record<string, unknown>
  const residentKey =
    rec.residentKey === "discouraged" ||
    rec.residentKey === "preferred" ||
    rec.residentKey === "required"
      ? rec.residentKey
      : undefined
  const pubKeyCredParams = Array.isArray(rec.pubKeyCredParams)
    ? rec.pubKeyCredParams.filter(
        (alg): alg is number =>
          typeof alg === "number" && Number.isSafeInteger(alg),
      )
    : []
  return {
    rpId: typeof rec.rpId === "string" ? rec.rpId : "",
    rpName: typeof rec.rpName === "string" ? rec.rpName : "",
    challenge: requireText(rec.challenge, "challenge"),
    userId: requireText(rec.userId, "userId"),
    userName: typeof rec.userName === "string" ? rec.userName : "",
    userDisplayName:
      typeof rec.userDisplayName === "string" ? rec.userDisplayName : "",
    pubKeyCredParams,
    excludeCredentials: parseDescriptors(rec.excludeCredentials),
    residentKey,
    userVerification: parseUserVerification(rec.userVerification),
    origin: typeof rec.origin === "string" ? rec.origin : "",
    crossOrigin: rec.crossOrigin === true,
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

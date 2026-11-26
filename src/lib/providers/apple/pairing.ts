import { bigIntToBytes, bytesToBigInt } from "@/lib/bytes"
import { VaultError } from "../types"
import { decodePake, encodePake } from "./protocol"
import {
  type SrpClient,
  type SrpResult,
  sameSessionId,
  verifyServerProof,
} from "./srp"

/** The name the Mac shows when it asks to pair. Apple's own extension for Chrome sends "Chrome" in every language. */
const BROWSER_NAME = "Chrome"
const PROTOCOL_VERSION = "1.0"
export const SRP_WITH_RFC_VERIFICATION = 1

/** What the helper's first handshake reply gives for computing the proof. */
export interface Challenge {
  salt: Uint8Array
  serverPublicKey: bigint
}

/** The first handshake message, which sends the client's public key and makes the Mac show a code. */
export function challengeRequest(client: SrpClient): string {
  return JSON.stringify({
    QID: "m0",
    PAKE: encodePake({
      TID: client.username,
      MSG: 0,
      A: client.codec.encode(bigIntToBytes(client.publicKey)),
      VER: PROTOCOL_VERSION,
      PROTO: [SRP_WITH_RFC_VERIFICATION],
    }),
    HSTBRSR: BROWSER_NAME,
  })
}

/** Reads the helper's answer to the first message: the salt and its public key. */
export function readChallenge(
  client: SrpClient,
  payload: Record<string, unknown>,
): Challenge {
  const pake = pakeOf(client, payload)
  if (pake.ErrCode !== undefined && Number(pake.ErrCode) !== 0) {
    throw new VaultError(
      `Pairing was refused (error ${pake.ErrCode})`,
      "apple.refused",
    )
  }
  if (
    String(pake.MSG) !== "1" ||
    typeof pake.s !== "string" ||
    typeof pake.B !== "string"
  ) {
    throw new VaultError("Unexpected pairing reply", "apple.protocol")
  }
  if (
    pake.PROTO !== undefined &&
    Number(pake.PROTO) !== SRP_WITH_RFC_VERIFICATION
  ) {
    throw new VaultError(
      `Helper chose unsupported protocol ${pake.PROTO}`,
      "apple.unsupported",
    )
  }
  return {
    salt: client.codec.decode(pake.s),
    serverPublicKey: bytesToBigInt(client.codec.decode(pake.B)),
  }
}

/** The second handshake message, which proves the client knows the code. */
export function proofRequest(client: SrpClient, proof: Uint8Array): string {
  return JSON.stringify({
    QID: "m2",
    PAKE: encodePake({
      TID: client.username,
      MSG: 2,
      M: client.codec.encode(proof, false),
    }),
  })
}

/** Checks the helper's answer to the proof, which in turn proves that the helper knows the code. */
export function checkProofReply(
  client: SrpClient,
  payload: Record<string, unknown>,
  result: SrpResult,
): void {
  const pake = pakeOf(client, payload)
  if (String(pake.MSG) !== "3")
    throw new VaultError("Unexpected pairing reply", "apple.protocol")
  if (Number(pake.ErrCode) === 1)
    throw new VaultError("The code is incorrect", "apple.wrongCode")
  if (Number(pake.ErrCode) !== 0) {
    throw new VaultError(
      `Pairing failed (error ${pake.ErrCode})`,
      "apple.refused",
    )
  }
  if (
    typeof pake.HAMK !== "string" ||
    !verifyServerProof(result, client.codec.decode(pake.HAMK))
  ) {
    throw new VaultError(
      "The helper could not prove it knows the code",
      "apple.protocol",
    )
  }
}

/** The PAKE message of a handshake reply, which must belong to this client's session. */
function pakeOf(
  client: SrpClient,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const pake = decodePake(payload.PAKE)
  if (
    typeof pake.TID !== "string" ||
    !sameSessionId(client.codec, client.username, pake.TID)
  ) {
    throw new VaultError(
      "Pairing reply belongs to another session",
      "apple.protocol",
    )
  }
  return pake
}

import { describe, expect, it, vi } from "vitest"
import type { HelperMessage, HelperPortEvents } from "./helper-port"
import { HelperSession } from "./helper-session"
import { Cmd, decodePake, encodePake } from "./protocol"

/**
 * A session over a fake port. The fake helper answers the hello and the first handshake message,
 * which is enough to make it wait for a pairing code.
 */
function sessionWithFakeHelper() {
  let events: HelperPortEvents | null = null
  const port = {
    connected: false,
    connect: () => {
      port.connected = true
    },
    disconnect: () => {
      port.connected = false
    },
    post: vi.fn(),
    request: vi.fn(async (message: HelperMessage): Promise<HelperMessage> => {
      if (message.cmd === Cmd.Hello) return { cmd: Cmd.Hello, capabilities: {} }
      const { TID } = decodePake(JSON.parse(String(message.msg)).PAKE)
      return {
        cmd: Cmd.Handshake,
        payload: { PAKE: encodePake({ TID, MSG: 1, s: "0x01", B: "0x02" }) },
      }
    }),
  }
  const helper = new HelperSession((given) => {
    events = given
    return port
  })
  const unsolicited = (message: HelperMessage) => events?.onUnsolicited(message)
  return { helper, port, unsolicited }
}

async function waitingForCode() {
  const fake = sessionWithFakeHelper()
  await fake.helper.setEnabled(true)
  await fake.helper.startPairing(false)
  expect(fake.helper.getState().phase).toBe("awaitingCode")
  return fake
}

describe("HelperSession.cancelPairing", () => {
  it("tells the helper to close its code window and forgets the attempt", async () => {
    const { helper, port } = await waitingForCode()
    await helper.cancelPairing()
    expect(port.post).toHaveBeenCalledWith({ cmd: Cmd.DidCancelPINPairing })
    expect(helper.getState().phase).toBe("unpaired")
  })

  it("leaves the pairing alone when a view wants the code again by then", async () => {
    const { helper, port } = await waitingForCode()
    await helper.cancelPairing(() => true)
    expect(port.post).not.toHaveBeenCalled()
    expect(helper.getState().phase).toBe("awaitingCode")
  })

  it("sends nothing while no code is awaited", async () => {
    const { helper, port } = sessionWithFakeHelper()
    await helper.setEnabled(true)
    await helper.cancelPairing()
    expect(port.post).not.toHaveBeenCalled()
    expect(helper.getState().phase).toBe("unpaired")
  })
})

describe("HelperSession.onCodesChanged", () => {
  it("passes on the helper's word that its verification codes changed", () => {
    const { helper, unsolicited } = sessionWithFakeHelper()
    const listener = vi.fn()
    helper.onCodesChanged(listener)
    unsolicited({ cmd: Cmd.OneTimeCodeAvailable })
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

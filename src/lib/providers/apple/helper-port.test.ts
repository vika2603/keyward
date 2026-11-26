import { afterEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { checkHelper } from "./helper-port"
import { Cmd } from "./protocol"

/** The fake runtime, whose lastError the browser sets while a port closes. */
const runtime = fakeBrowser.runtime as { lastError?: { message: string } }

/** A native port the test answers for the helper; nothing reaches a real one. */
function fakeNativePort() {
  const messageListeners = new Set<(message: unknown) => void>()
  const disconnectListeners = new Set<() => void>()
  const port = {
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onMessage: {
      addListener: (listener: (message: unknown) => void) =>
        messageListeners.add(listener),
    },
    onDisconnect: {
      addListener: (listener: () => void) => disconnectListeners.add(listener),
    },
  }
  vi.spyOn(fakeBrowser.runtime, "connectNative").mockReturnValue(port as never)
  return {
    port,
    reply: (message: unknown) => {
      for (const listener of messageListeners) listener(message)
    },
    /** Closes the port as Chrome does, with the reason in runtime.lastError. */
    close: (reason: string) => {
      runtime.lastError = { message: reason }
      for (const listener of disconnectListeners) listener()
      runtime.lastError = undefined
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("checkHelper", () => {
  it("tells a missing host manifest from the reason Chrome gives", async () => {
    const helper = fakeNativePort()
    const check = checkHelper(1000)
    helper.close("Specified native messaging host not found.")
    await expect(check).resolves.toMatchObject({
      reached: false,
      problem: "notSetUp",
    })
  })

  it("reaches the helper once it says hello, then lets it go", async () => {
    const helper = fakeNativePort()
    const check = checkHelper(1000)
    expect(helper.port.postMessage).toHaveBeenCalledWith({ cmd: Cmd.Hello })
    helper.reply({ cmd: Cmd.Hello, capabilities: {} })
    await expect(check).resolves.toEqual({ reached: true })
    expect(helper.port.disconnect).toHaveBeenCalledOnce()
  })

  it("gives up on a helper that never answers", async () => {
    vi.useFakeTimers()
    const helper = fakeNativePort()
    const check = checkHelper(1000)
    await vi.advanceTimersByTimeAsync(1000)
    await expect(check).resolves.toMatchObject({
      reached: false,
      problem: "helperStopped",
    })
    expect(helper.port.disconnect).toHaveBeenCalledOnce()
  })
})

import { afterEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { checkHelper, type HelperMessage, HelperPort } from "./helper-port"
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

describe("HelperPort.request", () => {
  /** A connected port over a fake helper, with the messages sent to it. */
  function openPort() {
    const helper = fakeNativePort()
    const port = new HelperPort({
      onUnsolicited: () => {},
      onDisconnect: () => {},
    })
    port.connect()
    const sent = () =>
      helper.port.postMessage.mock.calls.map(
        ([message]) => message as HelperMessage,
      )
    /** Answers a sent message as the helper does, echoing its tab and frame IDs. */
    const answer = (request: HelperMessage | undefined, reply: object) =>
      helper.reply({
        tabId: request?.tabId,
        frameId: request?.frameId,
        ...reply,
      })
    return { helper, port, sent, answer }
  }

  const listingCmd = 4
  const saveCmd = 6
  const passwordCmd = 5

  it("drops a reply that comes after its request gave up, so it cannot answer the next one", async () => {
    vi.useFakeTimers()
    const { port, sent, answer } = openPort()
    const first = port.request(
      { cmd: listingCmd, url: "first.example" },
      { timeoutMs: 1000, tagged: true },
    )
    const firstGaveUp = expect(first).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(1000)
    await firstGaveUp
    const second = port.request(
      { cmd: listingCmd, url: "second.example" },
      { timeoutMs: 1000, tagged: true },
    )
    const [late, current] = sent()
    answer(late, { cmd: listingCmd, url: "first.example" })
    answer(current, { cmd: listingCmd, url: "second.example" })
    await expect(second).resolves.toMatchObject({ url: "second.example" })
  })

  it("gives a save and a listing that wait at once each their own reply", async () => {
    const { port, sent, answer } = openPort()
    const save = port.request(
      { cmd: saveCmd },
      { timeoutMs: 1000, replyCmd: listingCmd, tagged: true },
    )
    const listing = port.request(
      { cmd: listingCmd },
      { timeoutMs: 1000, tagged: true },
    )
    const [saveRequest, listingRequest] = sent()
    answer(listingRequest, { cmd: listingCmd, answers: "listing" })
    answer(saveRequest, { cmd: listingCmd, answers: "save" })
    await expect(listing).resolves.toMatchObject({ answers: "listing" })
    await expect(save).resolves.toMatchObject({ answers: "save" })
  })

  it("lets a newer read replace one still waiting, and drops the late answer to the old one", async () => {
    const { port, sent, answer } = openPort()
    const options = { timeoutMs: null, tagged: true, newestOnly: true }
    const older = port.request({ cmd: passwordCmd }, options)
    const olderReplaced = expect(older).rejects.toThrow("Replaced")
    const newer = port.request({ cmd: passwordCmd }, options)
    await olderReplaced
    const [olderRequest, newerRequest] = sent()
    answer(olderRequest, { cmd: passwordCmd, answers: "older" })
    answer(newerRequest, { cmd: passwordCmd, answers: "newer" })
    await expect(newer).resolves.toMatchObject({ answers: "newer" })
  })

  it("takes a reply without a frame ID as the answer to the oldest request for it", async () => {
    const { helper, port } = openPort()
    const listing = port.request(
      { cmd: listingCmd },
      { timeoutMs: 1000, tagged: true },
    )
    helper.reply({ cmd: listingCmd, answers: "listing" })
    await expect(listing).resolves.toMatchObject({ answers: "listing" })
  })
})

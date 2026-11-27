import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  NAV_MAX_WAIT_MS,
  NO_REQUEST_TIMEOUT_MS,
  SETTLE_AFTER_OK_MS,
  SubmissionGate,
} from "./submission-gate"
import { resetBackground, setFrame } from "./test-support"

vi.mock("./page", async () => (await import("./test-support")).pageModule)

const TAB = 12
const LOGIN_URL = "https://accounts.example.com/login"
const login = { username: "alice", password: "secret" }

beforeEach(() => {
  vi.useFakeTimers()
  resetBackground()
  setFrame(TAB, 0, LOGIN_URL)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("SubmissionGate", () => {
  it("passes username-only steps through immediately without waiting", async () => {
    const onReady = vi.fn()
    const gate = new SubmissionGate(onReady)
    await gate.submit(TAB, 0, { username: "alice", password: "" })
    expect(onReady).toHaveBeenCalledWith(
      TAB,
      0,
      { username: "alice", password: "" },
      new URL(LOGIN_URL),
    )
  })

  it("discards a submission when a same-site XHR POST fails with 4xx or 5xx", async () => {
    for (const statusCode of [400, 401, 403, 422, 500]) {
      const onReady = vi.fn()
      const gate = new SubmissionGate(onReady)
      await gate.submit(TAB, 0, login)
      gate.onBeforeRequest({
        tabId: TAB,
        url: "https://api.example.com/v1/login",
        method: "POST",
        type: "xmlhttprequest",
      })
      gate.onCompleted({
        tabId: TAB,
        url: "https://api.example.com/v1/login",
        method: "POST",
        type: "xmlhttprequest",
        statusCode,
      })
      await vi.advanceTimersByTimeAsync(NAV_MAX_WAIT_MS + 1000)
      expect(onReady).not.toHaveBeenCalled()
    }
  })

  it("flushes shortly after a 2xx same-site XHR POST succeeds", async () => {
    const onReady = vi.fn()
    const gate = new SubmissionGate(onReady)
    await gate.submit(TAB, 0, login)
    gate.onCompleted({
      tabId: TAB,
      url: "https://api.example.com/session",
      method: "POST",
      type: "xmlhttprequest",
      statusCode: 200,
    })
    expect(onReady).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(SETTLE_AFTER_OK_MS)
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it("ignores third-party POST failures and falls back after the short timeout", async () => {
    const onReady = vi.fn()
    const gate = new SubmissionGate(onReady)
    await gate.submit(TAB, 0, login)
    gate.onCompleted({
      tabId: TAB,
      url: "https://telemetry.thirdparty.net/collect",
      method: "POST",
      type: "xmlhttprequest",
      statusCode: 429,
    })
    await vi.advanceTimersByTimeAsync(NO_REQUEST_TIMEOUT_MS - 1)
    expect(onReady).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it("waits for tab status complete during a Post-Redirect-Get login and keeps the original page URL", async () => {
    const onReady = vi.fn()
    const gate = new SubmissionGate(onReady)
    await gate.submit(TAB, 0, login)
    gate.onBeforeRequest({
      tabId: TAB,
      url: LOGIN_URL,
      method: "POST",
      type: "main_frame",
    })
    gate.onBeforeRedirect({
      tabId: TAB,
      url: LOGIN_URL,
      method: "POST",
      type: "main_frame",
      statusCode: 302,
    })
    gate.onTabUpdated(TAB, "loading")
    // Redirect target loads in the tab, changing the frame URL before completion.
    setFrame(TAB, 0, "https://app.example.com/dashboard")
    gate.onCompleted({
      tabId: TAB,
      url: "https://app.example.com/dashboard",
      method: "GET",
      type: "main_frame",
      statusCode: 200,
    })
    await vi.advanceTimersByTimeAsync(NO_REQUEST_TIMEOUT_MS)
    expect(onReady).not.toHaveBeenCalled()

    gate.onTabUpdated(TAB, "complete")
    await Promise.resolve()
    expect(onReady).toHaveBeenCalledWith(TAB, 0, login, new URL(LOGIN_URL))
  })

  it("discards on real network errors but survives ERR_ABORTED from redirects", async () => {
    const onReady = vi.fn()
    const gate = new SubmissionGate(onReady)
    await gate.submit(TAB, 0, login)
    gate.onErrorOccurred({
      tabId: TAB,
      url: "https://api.example.com/login",
      method: "POST",
      type: "xmlhttprequest",
      error: "net::ERR_CONNECTION_REFUSED",
    })
    await vi.advanceTimersByTimeAsync(NAV_MAX_WAIT_MS)
    expect(onReady).not.toHaveBeenCalled()

    await gate.submit(TAB, 0, login)
    gate.onErrorOccurred({
      tabId: TAB,
      url: "https://api.example.com/login",
      method: "POST",
      type: "xmlhttprequest",
      error: "net::ERR_ABORTED",
    })
    await vi.advanceTimersByTimeAsync(NO_REQUEST_TIMEOUT_MS)
    expect(onReady).toHaveBeenCalledTimes(1)
  })
})

import { beforeEach, describe, expect, it } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import type { Sender } from "@/lib/messaging"
import { menuSessions } from "./overlays"

const TAB = 3
const senderIn = (frameId: number) =>
  ({ tab: { id: TAB }, frameId, kind: "menu" }) as unknown as Sender

beforeEach(() => fakeBrowser.reset())

describe("overlay sessions", () => {
  it("lets the first frame with the token claim the session, and only that frame afterwards", async () => {
    await menuSessions.set({
      tabId: TAB,
      frameId: 0,
      token: "secret",
      overlayFrameId: null,
      kind: "login",
    })
    await expect(
      menuSessions.claim(senderIn(5), "secret"),
    ).resolves.toMatchObject({
      overlayFrameId: 5,
    })
    await expect(
      menuSessions.claim(senderIn(5), "secret"),
    ).resolves.toMatchObject({
      overlayFrameId: 5,
    })
    await expect(
      menuSessions.claim(senderIn(6), "secret"),
    ).rejects.toMatchObject({
      code: "forbidden",
    })
  })

  it("refuses a wrong or empty token without claiming the session", async () => {
    await menuSessions.set({
      tabId: TAB,
      frameId: 0,
      token: "secret",
      overlayFrameId: null,
      kind: "login",
    })
    await expect(
      menuSessions.claim(senderIn(5), "guess"),
    ).rejects.toMatchObject({
      code: "forbidden",
    })
    await expect(menuSessions.claim(senderIn(5), "")).rejects.toMatchObject({
      code: "forbidden",
    })
    await expect(
      menuSessions.claim(senderIn(5), undefined),
    ).rejects.toMatchObject({
      code: "forbidden",
    })
    expect((await menuSessions.get(TAB))?.overlayFrameId).toBeNull()
  })

  it("refuses an empty token even when the session has none", async () => {
    await menuSessions.set({
      tabId: TAB,
      frameId: 0,
      token: "",
      overlayFrameId: null,
      kind: "login",
    })
    await expect(menuSessions.claim(senderIn(5), "")).rejects.toMatchObject({
      code: "forbidden",
    })
  })

  it("reports a closed overlay when there is no session", async () => {
    await expect(
      menuSessions.claim(senderIn(5), "secret"),
    ).rejects.toMatchObject({
      code: "overlay.closed",
    })
  })
})

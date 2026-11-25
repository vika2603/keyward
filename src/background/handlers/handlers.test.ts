import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import type { Sender } from "@/lib/messaging"
import type { BackgroundApi } from "../api"
import { menus } from "../overlays"
import { accountVault, fakeProviders, pageModule } from "../test-support"
import { createHandlers } from "."

vi.mock("../page", () => pageModule)

const TAB = 3
const popup = { kind: "popup" } as Sender
const menuFrame = { kind: "menu", tab: { id: TAB }, frameId: 1 } as Sender

/** Calls a handler as the message listener does, so a check that throws becomes a rejection. */
function request<Type extends keyof BackgroundApi>(
  type: Type,
  payload: Record<string, unknown>,
  sender: Sender,
): Promise<unknown> {
  const handlers = createHandlers(
    fakeProviders([{ info: accountVault }]).providers,
  )
  return Promise.resolve().then(() =>
    handlers[type].handle(payload as never, sender),
  )
}

beforeEach(() => {
  fakeBrowser.reset()
})

describe("request checks", () => {
  it("refuses a vault ID that is not text as invalid input", async () => {
    for (const vaultId of [42, null, { id: accountVault.id }]) {
      await expect(
        request("popup.details", { vaultId, loginId: "item-1" }, popup),
      ).rejects.toMatchObject({ code: "invalidInput" })
    }
  })

  it("refuses a menu height that is not a number", async () => {
    await menus.set({
      tabId: TAB,
      frameId: 0,
      token: "menu-token",
      overlayFrameId: null,
      kind: "login",
    })
    await expect(
      request(
        "menu.resize",
        { token: "menu-token", height: "tall" },
        menuFrame,
      ),
    ).rejects.toMatchObject({ code: "invalidInput" })
    expect(pageModule.sendToFrame).not.toHaveBeenCalled()
  })
})

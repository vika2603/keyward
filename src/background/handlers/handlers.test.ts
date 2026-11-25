import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import type { Sender } from "@/lib/messaging"
import type { BackgroundApi } from "../api"
import { listHistory } from "../history"
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
  providers = fakeProviders([{ info: accountVault }]).providers,
): Promise<unknown> {
  const handlers = createHandlers(providers)
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

  it("takes a long site address alike for save targets, saving and the generator's history", async () => {
    const site = `https://example.com/${"path/".repeat(300)}`
    const { providers, calls } = fakeProviders([{ info: accountVault }])
    const { targets } = (await request(
      "popup.saveTargets",
      { site },
      popup,
      providers,
    )) as { targets: unknown[] }
    expect(targets).toHaveLength(1)
    await request(
      "popup.saveLogin",
      {
        vaultId: accountVault.id,
        site,
        username: "someone",
        password: "typed-password",
      },
      popup,
      providers,
    )
    expect(calls.save).toHaveBeenCalledOnce()
    await request(
      "generator.record",
      { password: "generated-password", site },
      popup,
    )
    expect(await listHistory()).toEqual([
      expect.objectContaining({ host: "example.com" }),
    ])
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

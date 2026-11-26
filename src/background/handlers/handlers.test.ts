import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import type { Sender } from "@/lib/messaging"
import type { BackgroundApi } from "../api"
import { listHistory } from "../history"
import { menuSessions } from "../overlays"
import {
  accountVault,
  appleVault,
  fakeProviders,
  idleNamedProviders,
  pageModule,
} from "../test-support"
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
  const handlers = createHandlers(providers, idleNamedProviders())
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

  it("saves a login with a username and no password, but not one with neither", async () => {
    const site = "https://example.com/"
    const { providers, calls } = fakeProviders([{ info: accountVault }])
    const save = (username: string) =>
      request(
        "popup.saveLogin",
        { vaultId: accountVault.id, site, username, password: "" },
        popup,
        providers,
      )
    await save("someone")
    expect(calls.save).toHaveBeenCalledWith(
      accountVault.id,
      expect.objectContaining({ username: "someone", password: "" }),
      expect.anything(),
    )
    await expect(save("  ")).rejects.toMatchObject({ code: "invalidInput" })
    expect(calls.save).toHaveBeenCalledOnce()
  })

  it("does not copy the empty password of a login without one", async () => {
    const { providers } = fakeProviders([
      {
        info: accountVault,
        credential: { username: "someone", password: "" },
      },
    ])
    await expect(
      request(
        "popup.copyPassword",
        { vaultId: accountVault.id, loginId: "item-1" },
        popup,
        providers,
      ),
    ).rejects.toMatchObject({ code: "noPassword" })
  })

  it("opens the popup on the connect view of a vault waiting for the user", async () => {
    const { providers } = fakeProviders([
      { info: { ...appleVault, status: "locked", awaitingUser: true } },
      { info: accountVault },
    ])
    expect(await request("popup.takeView", {}, popup, providers)).toEqual({
      name: "connect",
      kind: "apple",
    })
  })

  it("offers a picked authenticator key to the vaults that take one, as each takes it", async () => {
    await fakeBrowser.storage.session.set({
      "codeSetup.pending": {
        uri: "otpauth://totp/Example:someone?secret=JBSWY3DPEHPK3PXP&issuer=Example",
        pageUrl: "https://example.com/security",
        at: Date.now(),
      },
    })
    const lockedAccount = {
      ...accountVault,
      id: "bitwarden:b",
      status: "locked" as const,
    }
    const noCodes = { ...accountVault, id: "bitwarden:c" }
    const { providers, calls } = fakeProviders([
      { info: appleVault, codeSetup: "app" },
      { info: accountVault, codeSetup: "login" },
      { info: lockedAccount, codeSetup: "login" },
      { info: noCodes },
    ])
    const setup = (await request("popup.codeSetup", {}, popup, providers)) as {
      apple: boolean
      vaults: { id: string }[]
      locked: { id: string }[]
    }
    expect(setup.apple).toBe(true)
    expect(setup.vaults.map((vault) => vault.id)).toEqual([accountVault.id])
    expect(setup.locked.map((vault) => vault.id)).toEqual([lockedAccount.id])

    await request(
      "popup.setUpCode",
      { vaultId: appleVault.id },
      popup,
      providers,
    )
    expect(calls.setUpCode).toHaveBeenCalledWith(
      appleVault.id,
      null,
      new URL("https://example.com/security"),
      expect.stringMatching(/^otpauth:/),
    )
  })

  it("refuses a menu height that is not a number", async () => {
    await menuSessions.set({
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

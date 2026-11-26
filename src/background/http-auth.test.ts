import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { updateSettings } from "@/lib/settings"
import { type AuthChallenge, HttpAuth } from "./http-auth"
import {
  accountVault,
  appleVault,
  type FakeVault,
  fakeProviders,
  resetBackground,
} from "./test-support"

vi.mock("./page", async () => (await import("./test-support")).pageModule)

const ROUTER = "http://192.168.1.1/admin"
const login = { id: "item-1", username: "admin", title: "Router" }
const credential = { username: "admin", password: "{{SECRET_ggv3e2t4}}" }

function challenge(overrides: Partial<AuthChallenge> = {}): AuthChallenge {
  return {
    requestId: "7",
    url: ROUTER,
    scheme: "basic",
    isProxy: false,
    challenger: { host: "192.168.1.1", port: 80 },
    ...overrides,
  }
}

/** An HttpAuth whose popup shows as it opens, unless `shows` is false. */
function setUp(
  vaults: FakeVault[] = [{ info: accountVault, logins: [login], credential }],
  shows = true,
) {
  const { providers, calls } = fakeProviders(vaults)
  const openChooser = vi.fn(async () => {
    if (shows) httpAuth.showing()
  })
  const httpAuth = new HttpAuth(providers, openChooser)
  return { httpAuth, openChooser, calls }
}

/** Lets the challenge reach the point where it waits for the user; resolves to its answer to come. */
async function waitingFor(
  httpAuth: HttpAuth,
  openChooser: () => Promise<void>,
  asked = challenge(),
) {
  const answer = httpAuth.respond(asked)
  await vi.waitFor(() => expect(openChooser).toHaveBeenCalled())
  // Wrapped, as an async function would wait for a promise it returns.
  return { answer }
}

beforeEach(() => {
  resetBackground()
})

describe("answering a site's request for a login", () => {
  it("signs in with the login the user chooses, read for the site's address", async () => {
    const { httpAuth, openChooser, calls } = setUp()
    const { answer } = await waitingFor(httpAuth, openChooser)
    expect((await httpAuth.view())?.host).toBe("192.168.1.1")
    await httpAuth.answer(accountVault.id, "item-1")
    await expect(answer).resolves.toEqual({ authCredentials: credential })
    expect(calls.credential).toHaveBeenCalledWith(
      accountVault.id,
      "item-1",
      new URL(ROUTER),
    )
  })

  it("leaves the request to the browser when it asks again, as for a refused login", async () => {
    const { httpAuth, openChooser } = setUp()
    const { answer: first } = await waitingFor(httpAuth, openChooser)
    await httpAuth.answer(accountVault.id, "item-1")
    await first
    await expect(httpAuth.respond(challenge())).resolves.toEqual({})
    expect(openChooser).toHaveBeenCalledTimes(1)
  })

  it("leaves the request to the browser when the popup closes without a choice", async () => {
    const { httpAuth, openChooser } = setUp()
    const { answer } = await waitingFor(httpAuth, openChooser)
    httpAuth.leave()
    await expect(answer).resolves.toEqual({})
    expect(await httpAuth.view()).toBeNull()
  })

  it("still signs in when the popup closes while the password is read", async () => {
    const { httpAuth, openChooser, calls } = setUp()
    const { answer } = await waitingFor(httpAuth, openChooser)
    calls.credential.mockImplementation(() => httpAuth.leave())
    await httpAuth.answer(accountVault.id, "item-1")
    await expect(answer).resolves.toEqual({ authCredentials: credential })
  })

  it("refuses a vault that does not serve the site", async () => {
    const { httpAuth, openChooser } = setUp()
    await waitingFor(httpAuth, openChooser)
    await expect(
      httpAuth.answer(appleVault.id, "item-1"),
    ).rejects.toMatchObject({ code: "unknownVault" })
  })

  it("leaves a second request to the browser while one waits for the user", async () => {
    const { httpAuth, openChooser } = setUp()
    await waitingFor(httpAuth, openChooser)
    await expect(
      httpAuth.respond(challenge({ requestId: "8" })),
    ).resolves.toEqual({})
  })

  it("opens the popup for a vault to unlock while no vault is open", async () => {
    const { httpAuth, openChooser } = setUp([
      { info: { ...accountVault, status: "locked" } },
    ])
    void httpAuth.respond(challenge())
    await vi.waitFor(() => expect(openChooser).toHaveBeenCalled())
  })
})

describe("a popup that does not show", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("leaves the request to the browser after a few seconds", async () => {
    vi.useFakeTimers()
    const { httpAuth, openChooser } = setUp(undefined, false)
    const { answer } = await waitingFor(httpAuth, openChooser)
    await vi.advanceTimersByTimeAsync(5000)
    await expect(answer).resolves.toEqual({})
  })
})

describe("leaving a request to the browser at once", () => {
  it.each([
    ["a proxy asks", challenge({ isProxy: true })],
    [
      "the scheme signs in with the computer's account",
      challenge({ scheme: "ntlm" }),
    ],
    [
      "another server asks than the page's",
      challenge({ challenger: { host: "192.168.1.1", port: 8080 } }),
    ],
  ])("when %s", async (_case, asked) => {
    const { httpAuth, openChooser } = setUp()
    await expect(httpAuth.respond(asked)).resolves.toEqual({})
    expect(openChooser).not.toHaveBeenCalled()
  })

  it("when no vault has a login for the site", async () => {
    const { httpAuth, openChooser } = setUp([
      { info: accountVault, logins: [] },
    ])
    await expect(httpAuth.respond(challenge())).resolves.toEqual({})
    expect(openChooser).not.toHaveBeenCalled()
  })

  it("when the setting is off", async () => {
    await updateSettings({ httpAuth: false })
    const { httpAuth, openChooser } = setUp()
    await expect(httpAuth.respond(challenge())).resolves.toEqual({})
    expect(openChooser).not.toHaveBeenCalled()
  })
})

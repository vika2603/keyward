import { describe, expect, it, vi } from "vitest"
import { HelperApi, type HelperApiSession } from "./helper-api"

/** The API over a session whose helper answers each query with `reply`. */
function apiAnswering(reply: Record<string, unknown>) {
  const session = {
    query: vi.fn(async () => reply),
    post: vi.fn(),
    ensureConnected: vi.fn(async () => {}),
    capabilities: {},
    paired: true,
  } satisfies HelperApiSession
  return { api: new HelperApi(session), session }
}

describe("HelperApi.listLogins", () => {
  it("tells a site set never to save apart from its logins", async () => {
    const { api } = apiAnswering({
      STATUS: 0,
      Entries: [
        { USR: "someone", PWD: "Not Included", sites: ["example.com"] },
        { USR: "Passwords not saved", sites: ["example.com"] },
      ],
    })
    const listing = await api.listLogins("example.com")
    expect(listing.neverSaved).toBe(true)
    expect(listing.logins.map((login) => login.username)).toEqual(["someone"])
  })

  it("takes a site with only logins as one that saves", async () => {
    const { api } = apiAnswering({
      STATUS: 0,
      Entries: [{ USR: "someone", sites: ["example.com"] }],
    })
    expect((await api.listLogins("example.com")).neverSaved).toBe(false)
  })

  it("does not ask the helper about an address without a host name", async () => {
    const { api, session } = apiAnswering({ STATUS: 0 })
    expect(await api.listLogins("")).toEqual({ logins: [], neverSaved: false })
    expect(session.query).not.toHaveBeenCalled()
  })
})

describe("HelperApi.password", () => {
  it("gives none for a login that has only a passkey", async () => {
    const { api } = apiAnswering({
      STATUS: 0,
      Entries: [{ USR: "me", PWD: "", sites: ["example.com"] }],
    })
    expect(await api.password("example.com", "me")).toBeNull()
  })
})

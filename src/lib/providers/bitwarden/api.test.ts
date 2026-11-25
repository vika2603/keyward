import { afterEach, describe, expect, it, vi } from "vitest"
import { BitwardenApi, NetworkError } from "./api"
import { serverUrls } from "./server"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("BitwardenApi", () => {
  it("reports a request that never reached the server as a network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch")
      }),
    )
    const api = new BitwardenApi(serverUrls("https://vault.example.test"))
    await expect(api.sync("access-token")).rejects.toBeInstanceOf(NetworkError)
  })
})

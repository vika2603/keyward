import { afterEach, describe, expect, it, vi } from "vitest"
import { createForwardedAlias } from "./email-forwarding"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("email forwarding aliases", () => {
  it("creates aliases via SimpleLogin (including custom baseUrl)", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ email: "shop.abc@simplelogin.co" }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const alias = await createForwardedAlias({
      service: "simplelogin",
      apiKey: "sl-key",
      baseUrl: "https://sl.selfhosted.test/",
      website: "shop.example",
    })
    expect(alias).toBe("shop.abc@simplelogin.co")
    expect(fetchMock).toHaveBeenCalledWith(
      "https://sl.selfhosted.test/api/alias/random/new?hostname=shop.example",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authentication: "sl-key" }),
      }),
    )
  })

  it("creates aliases via Addy.io and validates required domain", async () => {
    await expect(
      createForwardedAlias({ service: "addyio", apiKey: "addy-key" }),
    ).rejects.toMatchObject({ code: "invalidInput" })

    const fetchMock = vi.fn(async () =>
      Response.json({ data: { email: "rand@user.anonaddy.com" } }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const alias = await createForwardedAlias({
      service: "addyio",
      apiKey: "addy-key",
      domain: "user.anonaddy.com",
    })
    expect(alias).toBe("rand@user.anonaddy.com")
  })

  it("creates aliases via Fastmail JMAP Masked Email", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      if (String(url).includes("/jmap/session")) {
        return Response.json({
          apiUrl: "https://api.fastmail.com/jmap/api/",
          primaryAccounts: {
            "https://www.fastmail.com/dev/maskedemail": "u123",
          },
        })
      }
      return Response.json({
        methodResponses: [
          [
            "MaskedEmail/set",
            {
              created: {
                "keyward-alias": { email: "masked.xyz@fastmail.com" },
              },
            },
            "0",
          ],
        ],
      })
    })
    vi.stubGlobal("fetch", fetchMock)
    const alias = await createForwardedAlias({
      service: "fastmail",
      apiKey: "fm-token",
      website: "news.example",
    })
    expect(alias).toBe("masked.xyz@fastmail.com")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("creates aliases via Firefox Relay, DuckDuckGo, and ForwardEmail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const target = String(url)
        if (target.includes("relay.firefox.com"))
          return Response.json({ full_address: "abc@mozmail.com" })
        if (target.includes("quack.duckduckgo.com"))
          return Response.json({ address: "quack-123" })
        return Response.json({ name: "fe-alias" })
      }),
    )

    expect(
      await createForwardedAlias({
        service: "firefoxRelay",
        apiKey: "ff-token",
      }),
    ).toBe("abc@mozmail.com")
    expect(
      await createForwardedAlias({
        service: "duckduckgo",
        apiKey: "ddg-token",
      }),
    ).toBe("quack-123@duck.com")
    expect(
      await createForwardedAlias({
        service: "forwardEmail",
        apiKey: "fe-key",
        domain: "my.example",
      }),
    ).toBe("fe-alias@my.example")
  })

  it("sends the API key to a self-hosted server only over HTTPS, or HTTP on this computer", async () => {
    const fetch = vi.fn(async () =>
      Response.json({ email: "alias@sl.example" }),
    )
    vi.stubGlobal("fetch", fetch)
    await expect(
      createForwardedAlias({
        service: "simplelogin",
        apiKey: "sl-key",
        baseUrl: "http://sl.example",
      }),
    ).rejects.toMatchObject({ code: "invalidSite" })
    expect(fetch).not.toHaveBeenCalled()
    await createForwardedAlias({
      service: "simplelogin",
      apiKey: "sl-key",
      baseUrl: "http://localhost:7777",
    })
    expect(fetch).toHaveBeenCalledOnce()
  })
})

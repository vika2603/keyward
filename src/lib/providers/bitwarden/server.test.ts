import { describe, expect, it } from "vitest"
import {
  EU_SERVER,
  isCloudServer,
  normalizeServerAddress,
  serverHost,
  serverUrls,
} from "./server"

describe("serverUrls", () => {
  it("uses bitwarden.com for the empty address", () => {
    expect(serverUrls("")).toEqual({
      base: "",
      api: "https://api.bitwarden.com",
      identity: "https://identity.bitwarden.com",
    })
  })

  it("uses the EU region's own endpoints", () => {
    expect(serverUrls(EU_SERVER)).toEqual({
      base: EU_SERVER,
      api: "https://api.bitwarden.eu",
      identity: "https://identity.bitwarden.eu",
    })
  })

  it("puts a self-hosted server's endpoints under its address", () => {
    expect(serverUrls("vault.example.com/")).toEqual({
      base: "https://vault.example.com",
      api: "https://vault.example.com/api",
      identity: "https://vault.example.com/identity",
    })
  })

  it("takes separately given endpoints over the derived ones", () => {
    const urls = serverUrls("https://vault.example.com", {
      identity: "login.example.com/",
    })
    expect(urls.api).toBe("https://vault.example.com/api")
    expect(urls.identity).toBe("https://login.example.com")
  })
})

describe("serverHost", () => {
  it("names cloud regions by their domain", () => {
    expect(serverHost("")).toBe("bitwarden.com")
    expect(serverHost(EU_SERVER)).toBe("bitwarden.eu")
    expect(serverHost("https://vault.example.com:8443")).toBe(
      "vault.example.com:8443",
    )
  })
})

describe("isCloudServer", () => {
  it("tells cloud regions from self-hosted servers", () => {
    expect(isCloudServer("")).toBe(true)
    expect(isCloudServer("vault.bitwarden.eu")).toBe(true)
    expect(isCloudServer("https://vault.example.com")).toBe(false)
  })
})

describe("normalizeServerAddress", () => {
  it("refuses text that is not a web address", () => {
    expect(() => normalizeServerAddress("not a url")).toThrow()
    expect(() => normalizeServerAddress("ftp://vault.example.com")).toThrow()
  })
})

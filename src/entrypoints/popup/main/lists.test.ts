import { describe, expect, it } from "vitest"
import type { VaultView } from "@/background/api"
import type { VaultStatus } from "@/lib/providers/types"
import { mainLists } from "./lists"

function appleVault(status: VaultStatus): VaultView {
  return { id: "apple", kind: "apple", label: "", status, logins: [] }
}

function bitwardenVault(status: VaultStatus): VaultView {
  return {
    id: "bitwarden:work",
    kind: "bitwarden",
    label: "work@example.com",
    status,
    logins:
      status === "ready"
        ? [{ id: "w1", username: "octocat", title: "GitHub" }]
        : [],
  }
}

const noSearch = { results: null, allItems: null, query: "" }

describe("mainLists", () => {
  it("narrows to the chosen provider while the tabs show", () => {
    const lists = mainLists({
      ...noSearch,
      vaults: [appleVault("ready"), bitwardenVault("ready")],
      tab: "bitwarden",
    })
    expect(lists.tabsShown).toBe(true)
    expect(lists.shown.map((vault) => vault.kind)).toEqual(["bitwarden"])
  })

  it("gives Passwords a large card while it needs setup", () => {
    const lists = mainLists({
      ...noSearch,
      vaults: [
        { ...appleVault("unavailable"), needsSetup: true },
        bitwardenVault("locked"),
      ],
      tab: "all",
    })
    expect(lists.locked.map((vault) => vault.kind)).toEqual([
      "apple",
      "bitwarden",
    ])
    expect(lists.listed).toEqual([])
  })

  it("shows every vault once locking hides the tabs", () => {
    const lists = mainLists({
      ...noSearch,
      vaults: [appleVault("locked"), bitwardenVault("locked")],
      tab: "bitwarden",
    })
    expect(lists.locked.map((vault) => vault.kind)).toEqual([
      "apple",
      "bitwarden",
    ])
    expect(lists.activeTab).toBe("all")
  })

  it("keeps the whole-vault browser open while searching a single provider", () => {
    const ready = bitwardenVault("ready")
    const lists = mainLists({
      vaults: [appleVault("ready"), ready],
      results: [ready],
      allItems: [ready],
      query: "git",
      tab: "bitwarden",
    })
    expect(lists.browsing).toBe(true)
    expect(lists.search).toBe("git")
  })
})

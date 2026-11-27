import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { newListPlace } from "./main/list-place"
import {
  clearViewCache,
  deserializeListPlace,
  loadAddDraft,
  loadEditDraft,
  loadNoteDraft,
  loadViewCache,
  saveAddDraft,
  saveEditDraft,
  saveNavigationState,
  saveNoteDraft,
  VIEW_CACHE_TTL_MS,
} from "./view-cache"

beforeEach(() => {
  vi.useFakeTimers()
  fakeBrowser.reset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("popup view cache", () => {
  it("persists and restores navigation state, query, and scroll position within TTL", async () => {
    const place = newListPlace()
    place.tab = "bitwarden"
    place.scrollTop = 240
    place.foldedSiteVaults = new Set(["bitwarden:a"])

    await saveNavigationState({ name: "generator" }, "bank", place)

    const loaded = await loadViewCache()
    expect(loaded).not.toBeNull()
    expect(loaded?.view).toEqual({ name: "generator" })
    expect(loaded?.query).toBe("bank")
    const restoredPlace = loaded ? deserializeListPlace(loaded.place) : null
    expect(restoredPlace?.tab).toBe("bitwarden")
    expect(restoredPlace?.scrollTop).toBe(240)
    expect([...(restoredPlace?.foldedSiteVaults ?? [])]).toEqual([
      "bitwarden:a",
    ])
  })

  it("ignores ephemeral views like connect and httpAuth", async () => {
    const place = newListPlace()
    await saveNavigationState({ name: "httpAuth" }, "", place)
    expect(await loadViewCache()).toBeNull()
    await saveNavigationState({ name: "connect", kind: "bitwarden" }, "", place)
    expect(await loadViewCache()).toBeNull()
  })

  it("expires cached state after VIEW_CACHE_TTL_MS", async () => {
    await saveNavigationState({ name: "main" }, "github", newListPlace())
    vi.advanceTimersByTime(VIEW_CACHE_TTL_MS + 1)
    expect(await loadViewCache()).toBeNull()
  })

  it("retains and clears add, edit, and note form drafts", async () => {
    await saveAddDraft({
      site: "example.com",
      username: "alice",
      password: "secret",
      vaultId: "bitwarden:a",
      folderId: null,
      details: { name: "Example", notes: "", totp: "", customFields: [] },
    })
    await saveEditDraft("bitwarden:a:item-1", {
      name: "Edited",
      username: "alice",
      password: "pw",
      uris: [{ uri: "https://example.com", match: null }],
      notes: "draft note",
      totp: "",
      customFields: [],
    })
    await saveNoteDraft("new", {
      name: "Draft note",
      text: "hello",
      customFields: [],
    })

    expect((await loadAddDraft())?.username).toBe("alice")
    expect((await loadEditDraft("bitwarden:a:item-1"))?.notes).toBe(
      "draft note",
    )
    expect((await loadNoteDraft("new"))?.text).toBe("hello")

    await clearViewCache()
    expect(await loadAddDraft()).toBeNull()
    expect(await loadEditDraft("bitwarden:a:item-1")).toBeNull()
    expect(await loadNoteDraft("new")).toBeNull()
  })
})

import { beforeEach, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"

beforeEach(() => {
  fakeBrowser.reset()
  vi.resetModules()
})

it("reads nothing from storage when loaded, as in every frame the content script runs in", async () => {
  const get = vi.spyOn(fakeBrowser.storage.local, "get")
  await import("./account-store")
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(get).not.toHaveBeenCalled()
})

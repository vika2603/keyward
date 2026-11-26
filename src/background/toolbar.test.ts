import { beforeEach, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { updateSettings } from "@/lib/settings"
import {
  accountVault,
  fakeProviders,
  pageModule,
  resetBackground,
} from "./test-support"
import { watchToolbar } from "./toolbar"

vi.mock("./page", async () => (await import("./test-support")).pageModule)

const TAB = 9
const setBadgeText = vi.fn(async () => {})

beforeEach(() => {
  resetBackground()
  setBadgeText.mockClear()
  // The fake browser has no action API.
  Object.assign(fakeBrowser, {
    action: {
      setBadgeText,
      setBadgeBackgroundColor: async () => {},
      setBadgeTextColor: async () => {},
      setIcon: async () => {},
    },
  })
  pageModule.activeTab.mockResolvedValue({
    id: TAB,
    url: "https://accounts.example.com/login",
  })
})

it("shows the page's number of logins on the badge until the setting turns it off", async () => {
  const login = { id: "item-1", username: "someone", title: "Example" }
  const { providers } = fakeProviders([
    { info: accountVault, logins: [login, { ...login, id: "item-2" }] },
  ])
  const refresh = watchToolbar(providers)
  await vi.waitFor(() =>
    expect(setBadgeText).toHaveBeenLastCalledWith({ tabId: TAB, text: "2" }),
  )

  await updateSettings({ loginCountBadge: false })
  refresh()
  await vi.waitFor(() =>
    expect(setBadgeText).toHaveBeenLastCalledWith({ tabId: TAB, text: "" }),
  )
})

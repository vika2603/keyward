import { beforeEach, describe, expect, it } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { serveRequests } from "./messaging"

type Api = { "test.echo": { payload: string; result: string } }

function popupSender(): Browser.runtime.MessageSender {
  return {
    id: browser.runtime.id,
    url: browser.runtime.getURL("/popup.html"),
  }
}

/** Delivers a message as Chrome would and collects what the background answers. */
async function deliver(message: unknown): Promise<unknown[]> {
  const replies: unknown[] = []
  let answered: () => void = () => {}
  const reply = new Promise<void>((resolve) => {
    answered = resolve
  })
  const results = await fakeBrowser.runtime.onMessage.trigger(
    message,
    popupSender(),
    (response: unknown) => {
      replies.push(response)
      answered()
    },
  )
  // A listener that returns true answers later.
  if (results.includes(true)) await reply
  return replies
}

describe("serveRequests", () => {
  beforeEach(() => {
    fakeBrowser.reset()
    serveRequests<Api>(
      {
        "test.echo": { allow: ["popup"], handle: (text) => text },
      },
      () => "internal",
    )
  })

  it("answers a request it knows", async () => {
    const replies = await deliver({
      keyward: 1,
      type: "test.echo",
      payload: "hello",
    })
    expect(replies).toEqual([{ ok: true, value: "hello" }])
  })

  it("says a request it does not know is unsupported", async () => {
    const replies = await deliver({
      keyward: 1,
      type: "test.later",
      payload: null,
    })
    expect(replies).toEqual([
      { ok: false, error: "Unsupported request", code: "unsupported" },
    ])
  })

  it("leaves messages of other shapes to their own listeners", async () => {
    const replies = await deliver({ keywardOffscreen: 1, text: "copied" })
    expect(replies).toEqual([])
  })
})

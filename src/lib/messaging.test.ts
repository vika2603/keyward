import { beforeEach, describe, expect, it } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { serveRequests } from "./messaging"

type Api = { "test.echo": { payload: { text: string }; result: string } }

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
  if ((results as unknown[]).includes(true)) await reply
  return replies
}

describe("serveRequests", () => {
  beforeEach(() => {
    fakeBrowser.reset()
    serveRequests<Api>(
      {
        "test.echo": { allow: ["popup"], handle: ({ text }) => String(text) },
      },
      () => "internal",
    )
  })

  it("answers a request it knows", async () => {
    const replies = await deliver({
      keyward: 1,
      type: "test.echo",
      payload: { text: "hello" },
    })
    expect(replies).toEqual([{ ok: true, value: "hello" }])
  })

  it("gives a handler a payload without fields when the message has none", async () => {
    for (const payload of [null, "hello", 7]) {
      const replies = await deliver({ keyward: 1, type: "test.echo", payload })
      expect(replies).toEqual([{ ok: true, value: "undefined" }])
    }
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

  it("says a request named like an inherited property is unsupported", async () => {
    for (const type of ["constructor", "toString", "__proto__"]) {
      const replies = await deliver({ keyward: 1, type, payload: null })
      expect(replies).toEqual([
        { ok: false, error: "Unsupported request", code: "unsupported" },
      ])
    }
  })

  it("leaves messages of other shapes to their own listeners", async () => {
    const replies = await deliver({ keywardOffscreen: 1, text: "copied" })
    expect(replies).toEqual([])
  })
})

// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { textUpTo } from "./form-kind"

afterEach(() => {
  document.body.innerHTML = ""
})

describe("the text read around a field", () => {
  it("is the element's text with white space collapsed across its elements", () => {
    document.body.innerHTML = `<div id="form">
        Password <b>must  have</b>
        <i> at least</i>8<span>   </span> characters
      </div>`
    const form = document.getElementById("form") as HTMLElement
    expect(textUpTo(form, 100)).toBe("Password must have at least8 characters")
  })

  it("stops once it is longer than the limit", () => {
    document.body.innerHTML = `<div id="page">${"<p>Paragraph text</p>".repeat(1000)}</div>`
    const page = document.getElementById("page") as HTMLElement
    const text = textUpTo(page, 40)
    expect(text.length).toBeGreaterThan(40)
    expect(text.length).toBeLessThan(60)
    expect(text.startsWith("Paragraph textParagraph text")).toBe(true)
  })
})

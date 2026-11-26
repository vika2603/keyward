// @vitest-environment happy-dom
/**
 * Scores field and submit detection on DuckDuckGo's annotated form corpus, which
 * `mise run corpus` downloads; skipped without it. Each score has a floor, the score when it was
 * last raised: a change that lowers a score fails, and one that raises it should raise the floor.
 */
import fs from "node:fs"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import {
  type FoundFields,
  fillTargets,
  findFields,
  isFillable,
} from "./field-finder"
import { submitControlOf } from "./submit"
import { stubLayout } from "./test-support"

const CORPUS_DIR = process.env.KEYWARD_FORM_CORPUS

/** The corpus's labels for a field that takes a username. */
const USERNAME_LABELS = new Set([
  "username",
  "emailAddress",
  "username OR emailAddress",
])
/** Input types that take no typed text, left out of the count of other fields. */
const UNTYPED_TYPES = new Set([
  "hidden",
  "checkbox",
  "radio",
  "submit",
  "button",
  "image",
  "reset",
  "file",
  "password",
])

interface Score {
  hits: number
  of: number
}

/** Scores where higher is better, with their floors. */
const FLOORS = {
  /** Username and email fields on sign-in pages that offer logins. */
  signInUsernames: 278,
  /** Sign-in passwords whose login fill reaches the annotated username of the same form. */
  pairedUsernames: 256,
  /** Unlabelled password fields on sign-up pages that read as new. */
  signUpPasswords: 158,
  /** Fields labelled as a new password that read as new. */
  newPasswords: 81,
  /** Fields labelled as a current password that offer logins. */
  currentPasswords: 56,
  /** Fields labelled as a one-time code that read as code fields. */
  codes: 7,
  /** Annotated submit controls on sign-in and sign-up pages that a click reports. */
  submitControls: 280,
}
/** Scores of false detection, where lower is better, with their ceilings. */
const CEILINGS = {
  /** Typed fields of other data, or without a label, taken for a login, new password or code field. */
  otherFields: 63,
  /** Pages without a login, password or code field that still get the field icon. */
  pagesWithoutLogins: 4,
  /** Current passwords taken for new ones, which a suggested password would overwrite. */
  currentAsNew: 1,
}

type Scores = Record<keyof typeof FLOORS | keyof typeof CEILINGS, Score>

type PageKind = "signIn" | "signUp" | "other"

function pageKindOf(file: string): PageKind {
  if (/_login[^_]*\.html$/.test(file)) return "signIn"
  if (/signup[^_]*\.html$/.test(file)) return "signUp"
  return "other"
}

/** A snapshot's markup without what would load or run: scripts, frames, images and style sheets. */
function inertMarkup(file: string): string {
  return fs
    .readFileSync(path.join(CORPUS_DIR ?? "", file), "utf8")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<(iframe|link|img|object|embed|video|audio|source)\b[^>]*>/gi, "")
}

/** Whether the markup hides an element or an ancestor, with `hidden` or an inline `display: none`. */
function hiddenByMarkup(element: HTMLElement): boolean {
  for (let node: HTMLElement | null = element; node; node = node.parentElement)
    if (node.hasAttribute("hidden") || node.style.display === "none")
      return true
  return false
}

/**
 * Lays out every element as `stubLayout` does, except those the markup hides; the snapshots keep
 * no site style sheets, so styles that hide fields mostly do not apply.
 */
function stubCorpusLayout(): void {
  stubLayout()
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return hiddenByMarkup(this)
        ? new DOMRect(0, 0, 0, 0)
        : new DOMRect(10, 10, 200, 32)
    },
  )
}

type Role = "login" | "newPassword" | "code" | "none"

function roleOf(input: HTMLInputElement, found: FoundFields): Role {
  if (found.newPassword.includes(input)) return "newPassword"
  if (found.login.includes(input)) return "login"
  if (found.code.includes(input)) return "code"
  return "none"
}

function count(score: Score, hit: boolean): void {
  score.of++
  if (hit) score.hits++
}

/** Scores one snapshot, which is in the document. */
function isCredentialLabel(label: string | null): label is string {
  return (
    label !== null &&
    (USERNAME_LABELS.has(label) || /^(password|totp)(\.|$)/.test(label))
  )
}

function scorePage(kind: PageKind, scores: Scores): void {
  const found = findFields(document)
  const inputs = [...document.querySelectorAll("input")]
  const hasCredentialField = inputs.some((input) =>
    isCredentialLabel(input.getAttribute("data-manual-scoring")),
  )
  if (!hasCredentialField)
    count(
      scores.pagesWithoutLogins,
      found.login.length + found.newPassword.length + found.code.length > 0,
    )
  for (const input of inputs) {
    const label = input.getAttribute("data-manual-scoring")
    const role = roleOf(input, found)
    if (!isCredentialLabel(label)) {
      if (!UNTYPED_TYPES.has(input.type) && isFillable(input))
        count(scores.otherFields, role !== "none")
      continue
    }
    if (!isFillable(input)) continue
    if (USERNAME_LABELS.has(label) && kind === "signIn")
      count(scores.signInUsernames, role === "login")
    if (label === "password" && kind === "signUp")
      count(scores.signUpPasswords, role === "newPassword")
    if (label === "password.new")
      count(scores.newPasswords, role === "newPassword")
    if (label === "password.current") {
      count(scores.currentPasswords, role === "login")
      count(scores.currentAsNew, role === "newPassword")
    }
    if (label === "totp") count(scores.codes, role === "code")
  }
  if (kind === "other") return
  if (kind === "signIn")
    for (const password of found.login.filter(
      (field) => field.type === "password",
    )) {
      const usernames = inputs.filter(
        (input) =>
          USERNAME_LABELS.has(
            input.getAttribute("data-manual-scoring") ?? "",
          ) &&
          input.form === password.form &&
          isFillable(input),
      )
      if (!usernames.length) continue
      const username = fillTargets(password).username
      count(
        scores.pairedUsernames,
        username !== null && usernames.includes(username),
      )
    }
  for (const control of document.querySelectorAll("[data-manual-submit]"))
    count(scores.submitControls, submitControlOf(control) !== null)
}

describe.skipIf(!CORPUS_DIR)("DuckDuckGo's annotated form corpus", () => {
  it("keeps every score at or above its floor", () => {
    stubCorpusLayout()
    const index: { html: string; title?: string }[] = JSON.parse(
      fs.readFileSync(path.join(CORPUS_DIR ?? "", "index.json"), "utf8"),
    )
    const scores = Object.fromEntries(
      [...Object.keys(FLOORS), ...Object.keys(CEILINGS)].map((name) => [
        name,
        { hits: 0, of: 0 },
      ]),
    ) as Scores
    for (const { html, title } of index) {
      const file = path.basename(html)
      document.body.innerHTML = inertMarkup(file)
      // The snapshots keep only the page body; the index records the title of some.
      document.title = title ?? ""
      scorePage(pageKindOf(file), scores)
    }
    document.body.innerHTML = ""

    const lines = Object.entries(scores).map(
      ([name, { hits, of }]) => `${name.padEnd(18)} ${hits} of ${of}`,
    )
    console.log(`Scores on ${index.length} forms:\n${lines.join("\n")}`)
    for (const [name, floor] of Object.entries(FLOORS))
      expect(
        scores[name as keyof typeof FLOORS].hits,
        name,
      ).toBeGreaterThanOrEqual(floor)
    for (const [name, ceiling] of Object.entries(CEILINGS))
      expect(
        scores[name as keyof typeof CEILINGS].hits,
        name,
      ).toBeLessThanOrEqual(ceiling)
  })
})

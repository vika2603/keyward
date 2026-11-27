import type { ContentMessage } from "@/background/api"
import type { FieldRules } from "@/lib/password-rules"
import { deepActiveElement } from "./deep-dom"
import {
  fieldRulesOf,
  fillTargets,
  isOccluded,
  newPasswordTargets,
} from "./field-finder"
import { isPasswordField } from "./field-hints"
import type { FieldTracker } from "./field-tracker"
import {
  fillCodeField,
  fillCustomFields,
  leavesFieldEmpty,
  setFieldValue,
  submitFor,
} from "./fill-dom"
import type { InlineMenu } from "./overlays"

type Message<T extends ContentMessage["type"]> = Extract<
  ContentMessage,
  { type: T }
>

/** A field that may anchor a fill, and the check it must pass; without a check it is taken as it is. */
type Candidate = readonly [
  field: HTMLInputElement | null | undefined,
  accepts?: (field: HTMLInputElement) => boolean,
]

/** The first candidate, in order of preference, that is set and passes its check. */
export function resolveAnchor(
  candidates: readonly Candidate[],
): HTMLInputElement | null {
  for (const [field, accepts] of candidates)
    if (field && (!accepts || accepts(field))) return field
  return null
}

function focusedInput(): HTMLInputElement | null {
  const focused = deepActiveElement()
  return focused instanceof HTMLInputElement ? focused : null
}

/** Whether the current frame is sandboxed, where autofilling secrets is refused. */
export function isSandboxedFrame(): boolean {
  if (location.origin === "null") return true
  try {
    return window.frameElement?.hasAttribute("sandbox") === true
  } catch {
    // Accessing frameElement throws in a cross-origin iframe, which is not necessarily sandboxed.
    return false
  }
}

/**
 * Fills what the background sends after the user picked it in a menu. Each fill goes into the
 * form of an anchor field: the menu's field, the focused field, the field the menu was last opened
 * for, or a field the page offers, as each fill's rules allow.
 */
export class FillHandlers {
  private fillingNow = false

  constructor(
    private readonly menu: InlineMenu,
    private readonly fields: FieldTracker,
    /** The field the menu was last opened for. */
    private readonly lastMenuField: () => HTMLInputElement | null,
    private readonly isOwnNode?: (node: Node) => boolean,
  ) {}

  /** Whether a fill is moving the focus between fields, which must not reopen the menu. */
  get filling(): boolean {
    return this.fillingNow
  }

  private canFillField(field: HTMLInputElement): boolean {
    return !isOccluded(field, this.isOwnNode)
  }

  fill(message: Message<"fill">): void {
    // The background checked the login against this origin; the frame may have navigated since.
    if (isSandboxedFrame() || location.origin !== message.origin) return
    const anchor = resolveAnchor([
      [this.menu.openFor],
      [focusedInput(), (field) => this.fields.isLogin(field)],
      [this.lastMenuField(), (field) => field.isConnected],
      [this.fields.login.find(isPasswordField)],
      [this.fields.login[0]],
    ])
    this.menu.close()
    if (!anchor) return
    const { username, password } = fillTargets(anchor)
    const safeUsername =
      username && this.canFillField(username) ? username : null
    const safePassword =
      password && this.canFillField(password) ? password : null
    if (!safeUsername && !safePassword) return
    const filledFields = [safeUsername, safePassword].filter(
      (field) => field !== null,
    )
    this.whileFilling(() => {
      // Custom fields go first, so the focus ends on the login's own fields as typing would leave it.
      fillCustomFields(anchor, message.fields, filledFields)
      if (
        safeUsername &&
        message.username &&
        safeUsername.value !== message.username
      )
        setFieldValue(safeUsername, message.username)
      if (
        safePassword &&
        message.password &&
        safePassword.value !== message.password
      )
        setFieldValue(safePassword, message.password)
    })
    // A login without a password leaves a form that asks for one to the user, and so does a form
    // with a field still empty, such as a captcha or a code.
    const complete = Boolean(message.password) || !safePassword
    const submitField = safePassword ?? safeUsername
    if (
      message.autoSubmit &&
      complete &&
      submitField &&
      !leavesFieldEmpty(submitField)
    )
      submitFor(submitField)
  }

  fillCode(message: Message<"fillCode">): void {
    if (isSandboxedFrame() || location.origin !== message.origin) return
    const isCode = (field: HTMLInputElement) => this.fields.isCode(field)
    const anchor = resolveAnchor([
      [this.menu.openFor, isCode],
      [focusedInput(), isCode],
      [this.lastMenuField(), (field) => field.isConnected && isCode(field)],
      [this.fields.code[0], isCode],
    ])
    this.menu.close()
    if (!anchor || !this.canFillField(anchor)) return
    this.whileFilling(() => fillCodeField(anchor, message.code))
  }

  /**
   * Fills a generated password: from the in-page menu into its new-password field and the
   * confirmation beside it. From the right-click menu the right-clicked field has the focus; a
   * password field there gets the password even when it does not look new, as it was chosen, and
   * another field, such as a sign-up form's email, passes it to its form's new-password fields.
   * Returns whether any field got it.
   */
  fillNew(message: Message<"fillNew">): boolean {
    if (isSandboxedFrame() || location.origin !== message.origin) return false
    const candidates = this.targetsForNewPassword()
    this.menu.close()
    const targets = candidates.filter((field) => this.canFillField(field))
    this.whileFilling(() => {
      for (const field of targets) setFieldValue(field, message.password)
    })
    return targets.length > 0
  }

  /** What the fields `fillNew` would fill now set for a password; null when there are none. */
  newPasswordRules(): FieldRules | null {
    const targets = this.targetsForNewPassword()
    return targets.length ? fieldRulesOf(targets) : null
  }

  /** The fields a generated password goes into now, as `fillNew` describes. */
  private targetsForNewPassword(): HTMLInputElement[] {
    const isNewPassword = (field: HTMLInputElement) =>
      this.fields.isNewPassword(field)
    const anchor = resolveAnchor([
      [this.menu.openFor, isNewPassword],
      [focusedInput()],
      [
        this.lastMenuField(),
        (field) => field.isConnected && isNewPassword(field),
      ],
    ])
    if (!anchor) return []
    return isPasswordField(anchor) && !isNewPassword(anchor)
      ? [anchor]
      : newPasswordTargets(anchor, this.fields.newPassword)
  }

  private whileFilling(fill: () => void): void {
    this.fillingNow = true
    try {
      fill()
    } finally {
      this.fillingNow = false
    }
  }
}

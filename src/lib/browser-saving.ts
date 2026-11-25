/**
 * The browser's own offer to save passwords. Keyward turns it off while it asks to save instead, so
 * a submitted form brings up one prompt rather than two. Only one extension controls a browser
 * setting at a time: the one installed last.
 */
function passwordSaving() {
  return browser.privacy?.services.passwordSavingEnabled
}

/** Turns the browser's offer off, or gives the setting back to the user. */
export async function controlBrowserSaving(takeOver: boolean): Promise<void> {
  const setting = passwordSaving()
  if (!setting) return
  if (takeOver) await setting.set({ value: false })
  else await setting.clear({})
}

/**
 * Who decides whether the browser offers to save: this extension, another extension (such as
 * iCloud Passwords), a policy, or the user.
 */
export type BrowserSavingControl =
  | "keyward"
  | "otherExtension"
  | "policy"
  | "user"

export async function browserSavingControl(): Promise<BrowserSavingControl> {
  const setting = passwordSaving()
  if (!setting) return "policy"
  const { levelOfControl } = await setting.get({})
  switch (levelOfControl) {
    case "controlled_by_this_extension":
      return "keyward"
    case "controlled_by_other_extensions":
      return "otherExtension"
    case "not_controllable":
      return "policy"
    default:
      return "user"
  }
}

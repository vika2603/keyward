/** Opens the page that connects Passwords in a tab of its own, as the Terminal command it shows needs. */
export function openConnectPasswords(): Promise<unknown> {
  return browser.tabs.create({
    url: browser.runtime.getURL("/connect-passwords.html"),
  })
}

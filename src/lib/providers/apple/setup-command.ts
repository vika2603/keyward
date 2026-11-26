/** The repository that publishes scripts/setup.sh. */
const REPOSITORY = "vika2603/keyward"
const SCRIPT_PATH = "main/scripts/setup.sh"
const SCRIPT_URL = `https://raw.githubusercontent.com/${REPOSITORY}/${SCRIPT_PATH}`

/** Where a person can read the script before running it. */
export const SETUP_SCRIPT_PAGE = `https://github.com/${REPOSITORY}/blob/${SCRIPT_PATH}`

/**
 * The browsers the setup script can set up, by the name it takes after --browser; the script maps
 * each to the folder it reads host manifests from, which for ego lite is Chrome's. Chrome is its
 * default.
 */
export const SETUP_BROWSERS = ["chrome", "dia", "edge", "brave", "ego"] as const
export type SetupBrowser = (typeof SETUP_BROWSERS)[number]

export const SETUP_BROWSER_NAMES: Record<SetupBrowser, string> = {
  chrome: "Google Chrome",
  dia: "Dia",
  edge: "Microsoft Edge",
  brave: "Brave",
  ego: "ego lite",
}

/**
 * The browser the page most likely runs in, from the brands it reports. Browsers that report no
 * brand of their own count as Chrome, so the user confirms the choice.
 */
export function likelyBrowser(brands: readonly string[]): SetupBrowser {
  if (brands.includes("Microsoft Edge")) return "edge"
  if (brands.includes("Brave")) return "brave"
  return "chrome"
}

function browserOption(browser: SetupBrowser): string {
  return browser === "chrome" ? "" : `--browser ${browser} `
}

/** The Terminal command that lets the extension with this ID reach the Passwords helper. */
export function setupCommand(
  extensionId: string,
  browser: SetupBrowser,
): string {
  return `curl -fsSL ${SCRIPT_URL} | bash -s -- ${browserOption(browser)}${extensionId}`
}

/** The Terminal command that takes the setup of one browser away again. */
export function removalCommand(browser: SetupBrowser): string {
  return `curl -fsSL ${SCRIPT_URL} | bash -s -- ${browserOption(browser)}--uninstall`
}

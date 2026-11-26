/** The repository that publishes scripts/setup.sh. */
const REPOSITORY = "vika2603/keyward"
const SCRIPT_PATH = "main/scripts/setup.sh"
const SCRIPT_URL = `https://raw.githubusercontent.com/${REPOSITORY}/${SCRIPT_PATH}`

/** Where a person can read the script before running it. */
export const SETUP_SCRIPT_PAGE = `https://github.com/${REPOSITORY}/blob/${SCRIPT_PATH}`

/** The Terminal command that lets the extension with this ID reach the Passwords helper. */
export function setupCommand(extensionId: string): string {
  return `curl -fsSL ${SCRIPT_URL} | bash -s -- ${extensionId}`
}

/** The Terminal command that takes the setup away again. */
export function removalCommand(): string {
  return `curl -fsSL ${SCRIPT_URL} | bash -s -- --uninstall`
}

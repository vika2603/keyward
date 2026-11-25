/** The settings page shown, named by the address's hash, such as "vaults" or "onboard". */
export function currentHash(): string {
  return location.hash.replace(/^#/, "")
}

export function navigate(hash: string): void {
  location.hash = hash
}

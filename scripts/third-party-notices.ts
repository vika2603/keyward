import { readdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"

/** The folder of the output where each Vite build that WXT runs lists the packages it bundles. */
export const LICENSE_LISTS = ".licenses"

/** A bundled package, as Vite's license list gives it. */
interface License {
  name: string
  version: string
  identifier?: string
  text?: string
}

/**
 * The packages the stylesheet imports. Vite's lists leave them out, as they reach the build as
 * stylesheets and fonts rather than modules.
 */
async function stylesheetLicenses(): Promise<License[]> {
  const stylesheet = await readFile("src/assets/tailwind.css", "utf8")
  // The package name at the start of each import that is not a relative path.
  const names = [
    ...stylesheet.matchAll(/@import "((?:@[^/"]+\/)?[^./"][^/"]*)/g),
  ].flatMap(([, name]) => name ?? [])
  return Promise.all(
    names.map(async (name) => {
      const dir = path.join("node_modules", name)
      const { version, license } = JSON.parse(
        await readFile(path.join(dir, "package.json"), "utf8"),
      )
      const file = (await readdir(dir)).find((entry) =>
        /^licen[cs]e/i.test(entry),
      )
      const text = file && (await readFile(path.join(dir, file), "utf8"))
      return { name, version, identifier: license, text: text?.trim() }
    }),
  )
}

/**
 * Joins the builds' license lists in `outDir` into THIRD_PARTY_NOTICES.md, with what reaches the
 * build otherwise, and removes the lists.
 */
export async function writeNotices(outDir: string): Promise<void> {
  const listsDir = path.join(outDir, LICENSE_LISTS)
  const lists = await Promise.all(
    (await readdir(listsDir)).map(
      async (file): Promise<License[]> =>
        JSON.parse(await readFile(path.join(listsDir, file), "utf8")),
    ),
  )
  await rm(listsDir, { recursive: true })
  const licenses = new Map<string, License>()
  for (const license of [...lists.flat(), ...(await stylesheetLicenses())])
    licenses.set(`${license.name}@${license.version}`, license)

  const packages = [...licenses.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ name, version, identifier, text }) =>
      [`## ${name} ${version}${identifier ? ` (${identifier})` : ""}`, text]
        .filter(Boolean)
        .join("\n\n"),
    )
  const appleLicense = await readFile(
    "src/lib/site-data/LICENSE.apple.md",
    "utf8",
  )
  const notices = [
    "# Third-party notices",
    "Keyward bundles the following software and data.",
    ...packages,
    `## password-manager-resources (MIT)\n\nSite rules from https://github.com/apple/password-manager-resources\n\n${appleLicense.trim()}`,
    "## EFF large wordlist\n\nThe passphrase words come from the Electronic Frontier Foundation's large wordlist: https://www.eff.org/dice",
  ]
  await writeFile(
    path.join(outDir, "THIRD_PARTY_NOTICES.md"),
    `${notices.join("\n\n")}\n`,
  )
}

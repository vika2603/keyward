import type { Folder } from "@/lib/providers/types"
import { compareNames } from "./format"

export interface NestedFolderChoice {
  id: string
  /** Full slash-delimited Bitwarden folder path, e.g. "Work/Infra/Prod". */
  name: string
  /** Final segment shown at its indented depth, e.g. "Prod". */
  leafName: string
  depth: number
  /** Indented display label for flat `<Select>` menus. */
  label: string
}

function segmentsOf(name: string): string[] {
  return name
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
}

/**
 * Formats Bitwarden's slash-delimited folders (`Parent/Child/Leaf`) in hierarchical order with
 * visual indentation for dropdowns and folder lists.
 */
export function nestedFolderChoices(
  folders: readonly Folder[],
): NestedFolderChoice[] {
  const entries = folders.map((folder) => {
    const segments = segmentsOf(folder.name)
    const depth = Math.max(0, segments.length - 1)
    const leafName = segments.at(-1) ?? folder.name
    const prefix = depth > 0 ? `${"  ".repeat(depth - 1)}└ ` : ""
    return {
      id: folder.id,
      name: folder.name,
      segments,
      leafName,
      depth,
      label: `${prefix}${leafName}`,
    }
  })
  entries.sort((a, b) => {
    const limit = Math.min(a.segments.length, b.segments.length)
    for (let index = 0; index < limit; index++) {
      const cmp = compareNames(a.segments[index] ?? "", b.segments[index] ?? "")
      if (cmp !== 0) return cmp
    }
    return a.segments.length - b.segments.length
  })
  return entries.map(({ segments: _segments, ...choice }) => choice)
}

/**
 * Returns the IDs of `folderId` and any descendant folders nested under it via `/` prefixes
 * (e.g. selecting "Work" includes "Work/Infra").
 */
export function folderSubtreeIds(
  folders: readonly Folder[],
  folderId: string,
): Set<string> {
  const target = folders.find((folder) => folder.id === folderId)
  if (!target) return new Set([folderId])
  const base = segmentsOf(target.name).join("/").toLowerCase()
  const prefix = `${base}/`
  const ids = new Set<string>([folderId])
  for (const folder of folders) {
    const path = segmentsOf(folder.name).join("/").toLowerCase()
    if (path === base || path.startsWith(prefix)) ids.add(folder.id)
  }
  return ids
}

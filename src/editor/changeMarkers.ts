import { diffArrays } from "diff"

export type LineChange = "add" | "mod" | "del"

/**
 * Per-line changes of `current` against `base` (0-based line indexes in `current`).
 * A deletion is reported on the line that now follows it (the last line at end of file).
 * Above `maxLines` lines on either side the diff is skipped (returns an empty map).
 */
export function lineChanges(base: string, current: string, maxLines = 20_000): Map<number, LineChange> {
  const out = new Map<number, LineChange>()
  if (base === current) return out
  const a = base.split("\n")
  const b = current.split("\n")
  if (a.length > maxLines || b.length > maxLines) return out
  const parts = diffArrays(a, b)
  let line = 0
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!
    const n = p.count ?? p.value.length
    if (!p.added && !p.removed) {
      line += n
      continue
    }
    if (p.removed) {
      const next = parts[i + 1]
      if (next?.added) {
        // A replaced block: changed lines, plus pure additions or a deletion for the remainder.
        const added = next.count ?? next.value.length
        for (let k = 0; k < added; k++) out.set(line + k, k < n ? "mod" : "add")
        if (n > added && !out.has(line + added)) out.set(Math.min(line + added, b.length - 1), "del")
        line += added
        i++
      } else if (!out.has(Math.min(line, b.length - 1))) out.set(Math.min(line, b.length - 1), "del")
      continue
    }
    for (let k = 0; k < n; k++) out.set(line + k, "add")
    line += n
  }
  return out
}

/** Lines that differ between two versions of a buffer (for highlighting a reload). */
export function changedLines(before: string, after: string): number[] {
  return [...lineChanges(before, after)].filter(([, c]) => c !== "del").map(([l]) => l)
}

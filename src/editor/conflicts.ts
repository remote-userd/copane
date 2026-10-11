/** Merge-conflict blocks in a file: <<<<<<< current [||||||| base] ======= incoming >>>>>>>. */

export interface Conflict {
  /** Line of `<<<<<<<`. */
  start: number
  /** Line of `|||||||` (diff3 style) or null. */
  base: number | null
  /** Line of `=======`. */
  mid: number
  /** Line of `>>>>>>>`. */
  end: number
}

export function findConflicts(text: string): Conflict[] {
  const lines = text.split("\n")
  const out: Conflict[] = []
  let open: { start: number; base: number | null; mid: number | null } | null = null
  lines.forEach((l, i) => {
    if (l.startsWith("<<<<<<<")) open = { start: i, base: null, mid: null }
    else if (open && l.startsWith("|||||||") && open.mid === null) open.base = i
    else if (open && l.startsWith("=======") && open.mid === null) open.mid = i
    else if (open && l.startsWith(">>>>>>>") && open.mid !== null) {
      out.push({ start: open.start, base: open.base, mid: open.mid, end: i })
      open = null
    }
  })
  return out
}

export type Side = "current" | "incoming" | "both"

/** Lines of each side of a conflict. */
export function sides(lines: string[], c: Conflict): { current: string[]; incoming: string[] } {
  return { current: lines.slice(c.start + 1, c.base ?? c.mid), incoming: lines.slice(c.mid + 1, c.end) }
}

/** The text with one conflict replaced by the chosen side(s). */
export function resolveConflict(text: string, c: Conflict, side: Side): string {
  const lines = text.split("\n")
  const { current, incoming } = sides(lines, c)
  const keep = side === "current" ? current : side === "incoming" ? incoming : [...current, ...incoming]
  lines.splice(c.start, c.end - c.start + 1, ...keep)
  return lines.join("\n")
}

/** The conflict containing `row`, or the next one after it. */
export function conflictAt(list: Conflict[], row: number): Conflict | undefined {
  return list.find((c) => row >= c.start && row <= c.end) ?? list.find((c) => c.start > row)
}

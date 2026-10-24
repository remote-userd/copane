/**
 * Line editing (toggle comment, move, duplicate, delete, indent) as pure functions over the
 * file's lines. Positions are string indexes; the command layer converts to display columns.
 */

export interface Pos {
  row: number
  /** String index within the line. */
  index: number
}

/** Selection as anchor (where it started) and head (where the cursor is); equal when empty. */
export interface Sel {
  anchor: Pos
  head: Pos
}

export interface LineEdit {
  lines: string[]
  sel: Sel
}

const isEmpty = (s: Sel) => s.anchor.row === s.head.row && s.anchor.index === s.head.index

/**
 * Lines a selection covers. One ending at the very start of a line (whole lines picked with
 * Shift+Down) does not include that line, like VS Code.
 */
export function lineSpan(sel: Sel): { first: number; last: number } {
  const [a, b] = sel.anchor.row <= sel.head.row ? [sel.anchor, sel.head] : [sel.head, sel.anchor]
  const last = !isEmpty(sel) && b.row > a.row && b.index === 0 ? b.row - 1 : b.row
  return { first: a.row, last }
}

function mapSel(sel: Sel, f: (p: Pos) => Pos): Sel {
  return { anchor: f(sel.anchor), head: f(sel.head) }
}

const shiftRows = (sel: Sel, by: number): Sel => mapSel(sel, (p) => ({ row: p.row + by, index: p.index }))

const leadingWs = (line: string) => line.length - line.trimStart().length

/** Line comment token per filetype; null when the language has only block comments. */
const COMMENT: Record<string, string> = {
  typescript: "//",
  typescriptreact: "//",
  javascript: "//",
  javascriptreact: "//",
  tsx: "//",
  jsx: "//",
  go: "//",
  rust: "//",
  c: "//",
  cpp: "//",
  csharp: "//",
  java: "//",
  kotlin: "//",
  swift: "//",
  zig: "//",
  php: "//",
  scala: "//",
  dart: "//",
  scss: "//",
  less: "//",
  jsonc: "//",
  proto: "//",
  python: "#",
  bash: "#",
  sh: "#",
  zsh: "#",
  fish: "#",
  ruby: "#",
  yaml: "#",
  toml: "#",
  perl: "#",
  r: "#",
  elixir: "#",
  nix: "#",
  make: "#",
  makefile: "#",
  dockerfile: "#",
  cmake: "#",
  gitignore: "#",
  powershell: "#",
  lua: "--",
  sql: "--",
  haskell: "--",
  elm: "--",
  vim: '"',
  ini: ";",
  clojure: ";",
  lisp: ";",
  scheme: ";",
  asm: ";",
  erlang: "%",
  latex: "%",
  tex: "%",
}

export function commentPrefix(filetype: string | undefined | null): string | null {
  return (filetype && COMMENT[filetype]) || null
}

/**
 * Comment out the selected lines, or uncomment them when every non-blank one is commented.
 * The token goes at the smallest indent of the block, so the block stays aligned.
 * `mode` forces adding or removing (Ctrl+K Ctrl+C / Ctrl+K Ctrl+U).
 */
export function toggleComment(lines: string[], sel: Sel, prefix: string, mode?: "add" | "remove"): LineEdit {
  const { first, last } = lineSpan(sel)
  const rows = []
  for (let r = first; r <= last; r++) if ((lines[r] ?? "").trim()) rows.push(r)
  // A blank line alone gets a comment token, so Ctrl+/ on an empty line starts a comment.
  if (!rows.length) rows.push(first)
  const out = lines.slice()
  const isCommented = (r: number) => out[r]!.trimStart().startsWith(prefix)
  const commented = mode ? mode === "remove" : rows.every(isCommented)
  const delta = new Map<number, { at: number; len: number }>()
  if (commented) {
    for (const r of rows) {
      if (!isCommented(r)) continue
      const line = out[r]!
      const at = leadingWs(line)
      const len = prefix.length + (line[at + prefix.length] === " " ? 1 : 0)
      out[r] = line.slice(0, at) + line.slice(at + len)
      delta.set(r, { at, len: -len })
    }
  } else {
    const at = Math.min(...rows.map((r) => (out[r]!.trim() ? leadingWs(out[r]!) : Infinity)))
    const col = Number.isFinite(at) ? at : out[first]!.length
    for (const r of rows) {
      const line = out[r]!
      const pad = line.length < col ? " ".repeat(col - line.length) : ""
      out[r] = line.slice(0, col) + pad + prefix + " " + line.slice(col)
      delta.set(r, { at: col, len: pad.length + prefix.length + 1 })
    }
  }
  return { lines: out, sel: mapSel(sel, (p) => shiftIndex(p, delta.get(p.row))) }
}

/** Where a position lands after `len` characters are inserted (or removed, len < 0) at `at`. */
function shiftIndex(p: Pos, d: { at: number; len: number } | undefined): Pos {
  if (!d) return p
  if (d.len >= 0) return p.index >= d.at ? { row: p.row, index: p.index + d.len } : p
  return p.index > d.at ? { row: p.row, index: Math.max(d.at, p.index + d.len) } : p
}

/** Swap the selected lines with the line above (-1) or below (1); null at the edge of the file. */
export function moveLines(lines: string[], sel: Sel, dir: -1 | 1): LineEdit | null {
  const { first, last } = lineSpan(sel)
  if (dir === -1 ? first === 0 : last >= lines.length - 1) return null
  const out = lines.slice()
  const block = out.splice(first, last - first + 1)
  out.splice(first + dir, 0, ...block)
  return { lines: out, sel: shiftRows(sel, dir) }
}

/**
 * Copy the selected lines below (1) or above (-1). The selection follows the copy below, and
 * stays on the upper copy when copying up, so repeated presses keep stamping copies.
 */
export function duplicateLines(lines: string[], sel: Sel, dir: -1 | 1): LineEdit {
  const { first, last } = lineSpan(sel)
  const block = lines.slice(first, last + 1)
  const out = lines.slice()
  out.splice(last + 1, 0, ...block)
  return { lines: out, sel: dir === 1 ? shiftRows(sel, block.length) : sel }
}

/** Remove the selected lines; the cursor stays on the same row (or the new last line). */
export function deleteLines(lines: string[], sel: Sel): LineEdit {
  const { first, last } = lineSpan(sel)
  const out = lines.slice()
  out.splice(first, last - first + 1)
  if (!out.length) out.push("")
  const row = Math.min(first, out.length - 1)
  const index = Math.min(sel.head.index, out[row]!.length)
  const p = { row, index }
  return { lines: out, sel: { anchor: p, head: p } }
}

/** One level of indentation for a file: a tab when its lines are tab-indented, else spaces. */
export function indentString(lines: string[], spaces: number): string {
  let tabs = 0
  let space = 0
  for (const l of lines.slice(0, 2000)) {
    if (l[0] === "\t") tabs++
    else if (l[0] === " " && l.trim()) space++
  }
  return tabs > space ? "\t" : " ".repeat(spaces)
}

/** Indent every non-blank selected line by one level. A selection from column 0 grows to keep the indent. */
export function indentLines(lines: string[], sel: Sel, unit: string): LineEdit {
  const { first, last } = lineSpan(sel)
  const out = lines.slice()
  const delta = new Map<number, { at: number; len: number }>()
  for (let r = first; r <= last; r++) {
    if (!out[r]!.trim()) continue
    out[r] = unit + out[r]
    delta.set(r, { at: 0, len: unit.length })
  }
  return { lines: out, sel: mapSel(sel, (p) => (p.index === 0 ? p : shiftIndex(p, delta.get(p.row)))) }
}

/** Remove one level of indentation (a tab, or up to `width` spaces) from the selected lines. */
export function outdentLines(lines: string[], sel: Sel, width: number): LineEdit {
  const { first, last } = lineSpan(sel)
  const out = lines.slice()
  const delta = new Map<number, { at: number; len: number }>()
  for (let r = first; r <= last; r++) {
    const line = out[r]!
    let n = 0
    if (line[0] === "\t") n = 1
    else while (n < width && line[n] === " ") n++
    if (!n) continue
    out[r] = line.slice(n)
    delta.set(r, { at: 0, len: -n })
  }
  return { lines: out, sel: mapSel(sel, (p) => shiftIndex(p, delta.get(p.row))) }
}

/** Remove trailing spaces and tabs from every line, keeping the cursor inside its line. */
export function trimTrailingWhitespace(lines: string[], sel: Sel): LineEdit | null {
  const out = lines.map((l) => l.replace(/[ \t]+$/, ""))
  if (out.every((l, i) => l === lines[i])) return null
  return { lines: out, sel: mapSel(sel, (p) => ({ row: p.row, index: Math.min(p.index, out[p.row]!.length) })) }
}

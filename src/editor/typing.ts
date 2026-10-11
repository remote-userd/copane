/**
 * Typing behaviour VS Code users expect: Enter keeps the indent, brackets and quotes close
 * themselves, Home goes to the first character. Pure functions over the cursor's line, with
 * positions as string indexes; the editor converts to display columns.
 */

export const PAIRS: Record<string, string> = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'", "`": "`" }
const BRACKETS: Record<string, string> = { "(": ")", "[": "]", "{": "}" }
const QUOTES = new Set(['"', "'", "`"])
/** Auto-close only when the next character is one of these (or the line ends), like VS Code. */
const CLOSE_BEFORE = new Set([";", ":", ".", ",", "=", "}", "]", ")", ">", " ", "\t"])

export const isTypingPairChar = (ch: string) => ch in PAIRS || ch === ")" || ch === "]" || ch === "}"

const leading = (line: string) => line.length - line.trimStart().length

/**
 * What Enter inserts at `index`: a newline plus the line's indent, one level more after an
 * opening bracket, and between a bracket pair the closer goes to its own line.
 * `caret` is where the cursor ends, as an index into `text`.
 */
export function enterText(line: string, index: number, unit: () => string): { text: string; caret: number } {
  const indent = line.slice(0, Math.min(leading(line), index))
  const open = line.slice(0, index).trimEnd().slice(-1)
  const close = line.slice(index).trimStart()[0]
  if (!BRACKETS[open]) return { text: "\n" + indent, caret: indent.length + 1 }
  const inner = "\n" + indent + unit()
  if (close === BRACKETS[open]) return { text: inner + "\n" + indent, caret: inner.length }
  return { text: inner, caret: inner.length }
}

/**
 * Typing `ch` at `index`: "over" steps past the same closer already there, "pair" inserts the
 * closer too, null types it normally.
 */
export function typeChar(ch: string, line: string, index: number): "over" | "pair" | null {
  const next = line[index]
  const prev = line[index - 1]
  if (next === ch && (QUOTES.has(ch) || ch === ")" || ch === "]" || ch === "}")) return "over"
  if (!PAIRS[ch]) return null
  if (next !== undefined && !CLOSE_BEFORE.has(next)) return null
  // A quote after a word is an apostrophe (don't) or closes something; leave it alone.
  if (QUOTES.has(ch) && prev !== undefined && /[\w$"'`]/.test(prev)) return null
  return "pair"
}

/** Backspace between an empty pair, like ( ) or "", deletes both. */
export function deletesPair(line: string, index: number): boolean {
  const prev = line[index - 1]
  return prev !== undefined && PAIRS[prev] !== undefined && line[index] === PAIRS[prev]
}

/** Home: the first non-blank character, or the line start when already there. */
export function homeIndex(line: string, index: number): number {
  const first = leading(line)
  return index === first ? 0 : first
}

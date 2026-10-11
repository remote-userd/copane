import type { KeyEvent } from "@opentui/core"

/** Canonical "ctrl+shift+meta+name" string for a key event. */
export function keyToString(key: Pick<KeyEvent, "name" | "ctrl" | "meta" | "shift" | "option"> & { sequence?: string }): string {
  // Legacy terminals send Ctrl+J as a bare line feed (Enter sends CR).
  if (key.name === "linefeed" && !key.ctrl && !key.meta && !key.option) return "ctrl+j"
  // Alt+Shift+F / Alt+Shift+B arrive as ESC F / ESC B, which the parser reads as Alt+→ / Alt+←
  // (an old emacs mapping). Real Alt+arrows come as CSI sequences.
  if (key.sequence === "\x1bF") return "alt+shift+f"
  if (key.sequence === "\x1bB") return "alt+shift+b"
  // The parser leaves some keys unnamed: Alt+punctuation (ESC .) and, from terminals that send
  // them, CSI-u keys such as Ctrl+. (ESC [46;5u). Name them from the raw sequence.
  if (!key.name && key.sequence) {
    const alt = /^\x1b([!-~])$/.exec(key.sequence)
    if (alt) return `alt+${alt[1]}`
    const csiU = /^\x1b\[(\d+);(\d+)u$/.exec(key.sequence)
    if (csiU) {
      const bits = Number(csiU[2]) - 1
      const mods = [bits & 4 ? "ctrl" : "", bits & 2 ? "alt" : "", bits & 1 ? "shift" : ""].filter(Boolean)
      return [...mods, String.fromCodePoint(Number(csiU[1]))].join("+")
    }
  }
  // Alt+Shift+letter arrives as ESC + capital letter, named "K" rather than "k".
  const upper = /^[A-Z]$/.test(key.name)
  const parts: string[] = []
  if (key.ctrl) parts.push("ctrl")
  if (key.meta || key.option) parts.push("alt")
  if (key.shift || upper) parts.push("shift")
  parts.push(upper ? key.name.toLowerCase() : key.name)
  return parts.join("+")
}

/**
 * Normalize a user-written binding ("Ctrl+Shift+A", "alt+]") to keyToString form. A chord is
 * two keys separated by a space ("ctrl+k ctrl+c").
 */
export function normalizeBinding(binding: string): string {
  return binding.trim().split(/\s+/).map(normalizeKey).join(" ")
}

function normalizeKey(binding: string): string {
  const parts = binding
    .toLowerCase()
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean)
  const name = parts.pop() ?? ""
  const mods = new Set(parts.map((m) => (m === "meta" || m === "option" ? "alt" : m === "control" ? "ctrl" : m)))
  const out: string[] = []
  if (mods.has("ctrl")) out.push("ctrl")
  if (mods.has("alt")) out.push("alt")
  if (mods.has("shift")) out.push("shift")
  out.push(name)
  return out.join("+")
}

/** "ctrl+k ctrl+c" → "Ctrl+K Ctrl+C". */
export function prettyKeys(keys: string): string {
  return keys
    .split(" ")
    .map((k) =>
      k
        .split("+")
        .map((p) => (p.length === 1 ? p.toUpperCase() : p[0]!.toUpperCase() + p.slice(1)))
        .join("+"),
    )
    .join(" ")
}

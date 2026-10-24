import type { KeyEvent } from "@opentui/core"

/** Canonical "ctrl+alt+shift+cmd+name" string for a key event (cmd: Super, the Mac's Command key). */
export function keyToString(
  key: Pick<KeyEvent, "name" | "ctrl" | "meta" | "shift" | "option"> & { sequence?: string; super?: boolean },
): string {
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
      const mods = [bits & 4 ? "ctrl" : "", bits & 2 ? "alt" : "", bits & 1 ? "shift" : "", bits & 8 ? "cmd" : ""].filter(Boolean)
      return [...mods, String.fromCodePoint(Number(csiU[1]))].join("+")
    }
  }
  // Alt+Shift+letter arrives as ESC + capital letter, named "K" rather than "k".
  const upper = /^[A-Z]$/.test(key.name)
  const parts: string[] = []
  if (key.ctrl) parts.push("ctrl")
  if (key.meta || key.option) parts.push("alt")
  if (key.shift || upper) parts.push("shift")
  if (key.super) parts.push("cmd")
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
  const mods = new Set(parts.map((m) => MOD_ALIASES[m] ?? m))
  const out: string[] = []
  if (mods.has("ctrl")) out.push("ctrl")
  if (mods.has("alt")) out.push("alt")
  if (mods.has("shift")) out.push("shift")
  if (mods.has("cmd")) out.push("cmd")
  out.push(name)
  return out.join("+")
}

const MOD_ALIASES: Record<string, string> = {
  meta: "alt",
  option: "alt",
  control: "ctrl",
  command: "cmd",
  super: "cmd",
}

// Cmd with these moves the cursor (line ends, file ends) and deletes to the line start: text
// navigation the textarea does, never a Ctrl command.
const CMD_NATIVE = new Set(["left", "right", "up", "down", "home", "end", "backspace", "delete", "click"])

/**
 * The Ctrl binding a Cmd key stands for ("cmd+shift+p" → "ctrl+shift+p", also in chords), or null
 * when there's none: no Cmd in it, Ctrl held as well, or Cmd+arrows/Backspace (text navigation).
 */
export function cmdAsCtrl(keys: string): string | null {
  let any = false
  const out: string[] = []
  for (const k of keys.split(" ")) {
    const parts = k.split("+")
    const name = parts.pop()!
    if (!parts.includes("cmd")) {
      out.push(k)
      continue
    }
    if (parts.includes("ctrl") || CMD_NATIVE.has(name)) return null
    any = true
    out.push(["ctrl", ...parts.filter((p) => p !== "cmd"), name].join("+"))
  }
  return any ? out.join(" ") : null
}

/** "ctrl+p" → "cmd+p" where Cmd reaches the same binding (see cmdAsCtrl); null otherwise. */
export function ctrlAsCmd(keys: string): string | null {
  const swapped = keys
    .split(" ")
    .map((k) => {
      const parts = k.split("+")
      const name = parts.pop()!
      return parts.includes("ctrl") && !parts.includes("cmd") ? [...parts.filter((p) => p !== "ctrl"), "cmd", name].join("+") : k
    })
    .join(" ")
  return swapped !== keys && cmdAsCtrl(swapped) === keys ? swapped : null
}

const MAC_MODS: [string, string][] = [
  ["ctrl", "⌃"],
  ["alt", "⌥"],
  ["shift", "⇧"],
  ["cmd", "⌘"],
]
const MAC_NAMES: Record<string, string> = {
  left: "←",
  right: "→",
  up: "↑",
  down: "↓",
  backspace: "⌫",
  delete: "⌦",
  return: "⏎",
  enter: "⏎",
  escape: "⎋",
  tab: "⇥",
  space: "Space",
  pageup: "PgUp",
  pagedown: "PgDn",
  pgup: "PgUp",
  pgdn: "PgDn",
}

/** "ctrl+k ctrl+c" → "Ctrl+K Ctrl+C", or with mac "⌃K ⌃C" (Apple's order: ⌃⌥⇧⌘, no plus). */
export function prettyKeys(keys: string, mac = false): string {
  if (mac)
    return keys
      .split(" ")
      .map((k) => {
        const parts = k.split("+")
        const name = parts.pop()!
        const mods = MAC_MODS.filter(([m]) => parts.includes(m)).map(([, sym]) => sym)
        return (
          mods.join("") + (MAC_NAMES[name] ?? (name.length === 1 ? name.toUpperCase() : name[0]!.toUpperCase() + name.slice(1)))
        )
      })
      .join(" ")
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

/**
 * How to show a binding: as written off a Mac; on a Mac in symbols, with a Ctrl binding shown as
 * the Cmd key that reaches it when the terminal sends Cmd (`taken`: that Cmd key does something else).
 */
export function keyLabel(keys: string, opts: { mac: boolean; cmd: boolean; taken?: (cmdKeys: string) => boolean }): string {
  if (!opts.mac) return prettyKeys(keys)
  const cmd = opts.cmd ? ctrlAsCmd(keys) : null
  return prettyKeys(cmd && !opts.taken?.(cmd) ? cmd : keys, true)
}

/** Key names in a sentence ("Ctrl+Z undoes", "Ctrl+K E") written the Mac way, as keyLabel does. */
export function keyText(text: string, opts: { mac: boolean; cmd: boolean }): string {
  if (!opts.mac) return text
  return text.replace(
    /\b(?:(?:Ctrl|Alt|Shift|Cmd)\+)+(?:[A-Za-z0-9]+\b|[^\sA-Za-z0-9])(?: (?:Ctrl\+|Alt\+|Shift\+)*[A-Z](?![A-Za-z]))?/g,
    (m) => keyLabel(normalizeBinding(m), opts),
  )
}

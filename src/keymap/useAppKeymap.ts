import { useMemo, useRef } from "react"
import { useKeyboard } from "@opentui/react"
import type { KeyEvent } from "@opentui/core"
import { useWorkspace } from "../app/workspace"
import { buildBindings, lookup, sanitizeOverrides, startsChord, type Layer } from "./bindings"
import { runCommand } from "./commands"
import { cmdAsCtrl, keyLabel, keyToString } from "./keys"
import { isCmdReachable, macKeys } from "./platform"
import { completionVisible } from "../lsp/CompletionPopup"
import { SEARCH_PANEL_KEYS } from "../files/SearchPanel"

/**
 * Global key routing. Runs before the focused renderable, so matched keys are
 * preventDefault()-ed and never reach the textarea or the AI terminal.
 * Modals handle their own keys.
 *
 * A key that starts a chord (Ctrl+K in "ctrl+k ctrl+c") waits for the next key, as in VS Code.
 */
const WAITING = "Waiting for the second key..."

export function useAppKeymap(): ReturnType<typeof buildBindings> {
  const ws = useWorkspace()
  const bindings = useMemo(() => {
    const { overrides, unknown } = sanitizeOverrides(ws.config.keys)
    if (unknown.length) setTimeout(() => ws.notify(`Unknown commands in config keys: ${unknown.join(", ")}`, "warn"), 0)
    return buildBindings(overrides, { mac: macKeys(ws.config) })
  }, [ws])
  const pretty = (keys: string) => keyLabel(keys, { mac: macKeys(ws.config), cmd: isCmdReachable() })

  const chord = useRef<string | null>(null)

  useKeyboard((key: KeyEvent) => {
    const ui = ws.ui.get()
    if (ui.modal) {
      chord.current = null
      // Quit works under any dialog (it still asks about unsaved files), as the too-small screen promises.
      if (lookup(bindings.global, keyToString(key)) === "app.quit") {
        key.preventDefault()
        key.stopPropagation()
        ws.ui.set({ modal: null })
        void runCommand(ws, "app.quit")
      }
      return
    }
    // A cursor parked by the wheel comes back before any key acts on it.
    if (ui.focus === "editor") (ws.buffers.active?.textarea as { unpark?: () => void } | null | undefined)?.unpark?.()
    const k = keyToString(key)
    // An open completion list takes Tab to accept.
    if (k === "tab" && ui.focus === "editor" && completionVisible()) return
    // The SEARCH tab of the left pane owns its typing and its own keys (Ctrl+F: replace row...).
    const inSearch = ui.focus === "tree" && ui.sidebar === "search"
    if (inSearch && !chord.current && SEARCH_PANEL_KEYS.has(k)) return
    // While the find bar has the keyboard, editing keys (Ctrl+Z, Ctrl+A...) belong to its input.
    const layers: Layer[] =
      ui.focus === "ai" ? ["ai"] : (ui.focus === "editor" && ui.find?.active) || inSearch ? ["global"] : [ui.focus, "global"]
    if (chord.current) {
      const keys = `${chord.current} ${k}`
      chord.current = null
      key.preventDefault()
      key.stopPropagation()
      // The chord is done: drop "waiting for the second key" (quiet commands would leave it up).
      if (ws.ui.get().notice?.text.endsWith(WAITING)) ws.ui.set({ notice: null })
      const id = layers.map((l) => lookup(bindings[l], keys)).find(Boolean)
      if (id) void runCommand(ws, id)
      else if (k !== "escape") ws.notify(`${pretty(keys)} is not a command`)
      return
    }
    for (const layer of layers) {
      const id = lookup(bindings[layer], k)
      if (id) {
        key.preventDefault()
        key.stopPropagation()
        void runCommand(ws, id)
        return
      }
    }
    if (layers.some((l) => startsChord(bindings[l], k))) {
      key.preventDefault()
      key.stopPropagation()
      chord.current = k
      ws.notify(`${pretty(k)} was pressed. ${WAITING}`)
      return
    }
    // An unbound Cmd+letter would reach the tree's single-letter keys (A: new file) as the letter.
    if (key.super && ui.focus === "tree" && !inSearch && cmdAsCtrl(k) !== null) {
      key.preventDefault()
      key.stopPropagation()
    }
  })

  return bindings
}

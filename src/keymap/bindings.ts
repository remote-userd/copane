import { commands, type CommandId } from "./commands"
import { normalizeBinding } from "./keys"

export type Layer = "global" | "editor" | "tree" | "ai"

/** Default bindings. Keys use normalizeBinding() form. */
const defaultBindings: Record<Layer, Record<string, CommandId>> = {
  global: {
    "ctrl+q": "app.quit",
    "ctrl+s": "file.save",
    "ctrl+p": "file.picker",
    "ctrl+b": "focus.tree",
    "ctrl+e": "focus.editor",
    "ctrl+j": "focus.ai",
    "ctrl+w": "buffer.close",
    "ctrl+pagedown": "buffer.next",
    "ctrl+pageup": "buffer.prev",
    f1: "app.palette",
    "ctrl+shift+p": "app.palette",
    "ctrl+alt+p": "app.palette",
    "ctrl+alt+k": "app.help",
    "ctrl+l": "ai.sendContext",
    "ctrl+alt+r": "app.restart",
    "ctrl+alt+j": "view.toggleAi",
    "ctrl+alt+m": "view.maximizeEditor",
    "ctrl+f": "find.open",
    "ctrl+shift+h": "find.replace",
    "ctrl+g": "edit.gotoLine",
    "ctrl+alt+f": "search.files",
    "ctrl+shift+f": "search.files",
    "ctrl+alt+d": "git.changes",
    "ctrl+alt+g": "git.fileHistory",
    "ctrl+alt+b": "git.branches",
    "ctrl+alt+t": "buffer.reopenClosed",
    "ctrl+shift+t": "buffer.reopenClosed",
    "ctrl+t": "file.symbolInProject",
    // Ctrl+Shift+O arrives as Ctrl+O in most terminals.
    "ctrl+o": "file.symbolInFile",
    "ctrl+shift+o": "file.symbolInFile",
    "alt+1": "buffer.goto1",
    "alt+2": "buffer.goto2",
    "alt+3": "buffer.goto3",
    "alt+4": "buffer.goto4",
    "alt+5": "buffer.goto5",
    "alt+6": "buffer.goto6",
    "alt+7": "buffer.goto7",
    "alt+8": "buffer.goto8",
    "alt+9": "buffer.goto9",
    // VS Code's Ctrl+K chords.
    "ctrl+k ctrl+s": "app.help",
    "ctrl+k z": "view.maximizeEditor",
    "ctrl+k s": "file.saveAll",
    "ctrl+k v": "markdown.togglePreviewSide",
    "ctrl+k f": "ai.fixProblems",
    "ctrl+k d": "ai.reviewChanges",
    "alt+shift+v": "markdown.openPreview",
    "alt+left": "nav.back",
    "alt+right": "nav.forward",
    "ctrl+alt+left": "nav.back",
    "ctrl+alt+right": "nav.forward",
    "ctrl+alt+e": "lsp.problems",
    f8: "lsp.nextProblem",
    f12: "lsp.definition",
  },
  editor: {
    "ctrl+c": "edit.copy",
    "ctrl+x": "edit.cut",
    "ctrl+v": "edit.paste",
    "ctrl+a": "edit.selectAll",
    "ctrl+r": "buffer.reloadFromDisk",
    "ctrl+z": "edit.undo",
    "ctrl+y": "edit.redo",
    "ctrl+shift+z": "edit.redo",
    "ctrl+space": "lsp.complete",
    "ctrl+alt+i": "lsp.hover",
    "alt+z": "view.wordWrap",
    "ctrl+d": "edit.addOccurrence",
    "alt+h": "git.peekHunk",
    "alt+f5": "git.nextChange",
    "alt+shift+f5": "git.prevChange",
    "ctrl+alt+a": "edit.allOccurrences",
    f2: "lsp.rename",
    // Ctrl+. reaches us only from terminals that send CSI-u keys; Alt+. works everywhere.
    "ctrl+.": "lsp.quickFix",
    "alt+.": "lsp.quickFix",
    "alt+shift+o": "lsp.organizeImports",
    "shift+f12": "lsp.references",
    "ctrl+alt+l": "lsp.format",
    "alt+shift+f": "lsp.format",
    // Ctrl+/ arrives as Ctrl+_ in most terminals (the same byte as Ctrl+7).
    "ctrl+/": "edit.toggleComment",
    "ctrl+_": "edit.toggleComment",
    // Line keys sit where VS Code (Windows/Linux) has them.
    "alt+up": "edit.moveLineUp",
    "alt+down": "edit.moveLineDown",
    "alt+shift+up": "edit.duplicateLineUp",
    "alt+shift+down": "edit.duplicateLineDown",
    "ctrl+alt+up": "edit.duplicateLineUp",
    "ctrl+alt+down": "edit.duplicateLineDown",
    // Ctrl+Shift+K arrives as Ctrl+K (a chord prefix here), so Alt+Shift+K comes first.
    "alt+shift+k": "edit.deleteLine",
    // In the tree, the tree reveals its selected row itself.
    "alt+shift+r": "file.revealInOS",
    "ctrl+shift+k": "edit.deleteLine",
    tab: "edit.indent",
    "shift+tab": "edit.outdent",
    "ctrl+]": "edit.indentLine",
    "ctrl+k ctrl+c": "edit.addComment",
    "ctrl+k ctrl+u": "edit.removeComment",
    "ctrl+k ctrl+x": "edit.trimWhitespace",
    "ctrl+k ctrl+i": "lsp.hover",
    "ctrl+k ctrl+f": "lsp.format",
  },
  tree: {},
  // While the AI terminal is focused only these reach the editor; everything else goes to the CLI.
  ai: {
    "ctrl+q": "app.quit",
    "ctrl+b": "focus.tree",
    "ctrl+e": "focus.editor",
    "ctrl+j": "focus.editor",
    "ctrl+p": "file.picker",
    f1: "app.palette",
    "ctrl+alt+r": "app.restart",
    "ctrl+alt+j": "view.toggleAi",
    "ctrl+alt+d": "git.changes",
  },
}

export function buildBindings(
  overrides: Partial<Record<Layer, Record<string, CommandId | null>>> = {},
): Record<Layer, Map<string, CommandId>> {
  const out = {} as Record<Layer, Map<string, CommandId>>
  for (const layer of Object.keys(defaultBindings) as Layer[]) {
    const map = new Map<string, CommandId>()
    for (const [k, v] of Object.entries(defaultBindings[layer])) map.set(normalizeBinding(k), v)
    for (const [k, v] of Object.entries(overrides[layer] ?? {})) {
      if (v === null) map.delete(normalizeBinding(k))
      else map.set(normalizeBinding(k), v)
    }
    out[layer] = map
  }
  return out
}

/** Validate user overrides from config; unknown command ids are reported, not applied. */
export function sanitizeOverrides(
  keys: Partial<Record<Layer, Record<string, string | null>>>,
): { overrides: Partial<Record<Layer, Record<string, CommandId | null>>>; unknown: string[] } {
  const overrides: Partial<Record<Layer, Record<string, CommandId | null>>> = {}
  const unknown: string[] = []
  for (const [layer, map] of Object.entries(keys) as [Layer, Record<string, string | null>][]) {
    const out: Record<string, CommandId | null> = {}
    for (const [k, v] of Object.entries(map ?? {})) {
      if (v === null || v in commands) out[k] = v as CommandId | null
      else unknown.push(v)
    }
    overrides[layer] = out
  }
  return { overrides, unknown }
}

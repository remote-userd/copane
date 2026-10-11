import type { Workspace } from "../app/workspace"
import type { SymbolEntry } from "../lsp/LspManager"

/** LSP SymbolKind → short tag for lists. */
export const KIND_TAG: Record<number, string> = {
  2: "mod", 5: "class", 6: "method", 7: "prop", 8: "field", 9: "ctor", 10: "enum", 11: "iface", 12: "fn",
  13: "var", 14: "const", 22: "member", 23: "struct", 26: "type",
}

const DECL =
  /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(function\*?|class|interface|type|enum|const|let|var|def|fn|func|struct|impl|trait|pub\s+fn|pub\s+struct)\s+([A-Za-z_$][\w$]*)/
const METHOD = /^\s+(?:public\s+|private\s+|protected\s+|static\s+|async\s+|override\s+|get\s+|set\s+)*([A-Za-z_$][\w$]*)\s*\([^;]*\)\s*(?::[^=;{]+)?\{\s*$/
const TEST = /^\s*(describe|it|test)(?:\.\w+)?\(\s*(['"`])(.+?)\2/
const KIND: Record<string, number> = { function: 12, "function*": 12, class: 5, interface: 11, type: 26, enum: 10, const: 14, let: 13, var: 13, def: 12, fn: 12, "pub fn": 12, func: 12, struct: 23, "pub struct": 23, impl: 5, trait: 11 }
const NOT_METHODS = new Set(["if", "for", "while", "switch", "catch", "function", "return"])

/** Symbols found by pattern when no language server is available (any language, test blocks too). */
export function scanSymbols(path: string, text: string): SymbolEntry[] {
  const out: SymbolEntry[] = []
  text.split("\n").forEach((line, i) => {
    const d = DECL.exec(line)
    if (d) return out.push({ name: d[2]!, kind: KIND[d[1]!.replace(/\s+/g, " ")] ?? 12, path, line: i, character: line.indexOf(d[2]!), container: "" })
    const t = TEST.exec(line)
    if (t) return out.push({ name: `${t[1]} ${t[3]}`, kind: 12, path, line: i, character: line.indexOf(t[1]!), container: "" })
    const m = METHOD.exec(line)
    if (m && !NOT_METHODS.has(m[1]!)) out.push({ name: m[1]!, kind: 6, path, line: i, character: line.indexOf(m[1]!), container: "" })
  })
  return out
}

/** Symbols of a file: from its language server when it has one, else by pattern. */
export async function fileSymbols(ws: Workspace, path: string, text: string): Promise<SymbolEntry[]> {
  if (ws.lsp?.hasServer(path)) {
    const list = await ws.lsp.documentSymbols(path)
    if (list.length) return list
  }
  return scanSymbols(path, text)
}

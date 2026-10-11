import { useEffect, useMemo, useState } from "react"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { Modal } from "../app/Modal"
import { useWorkspace } from "../app/workspace"
import { ui as colors } from "../config/theme"
import { fuzzyFilter } from "./fuzzy"
import { join, relative, sep } from "node:path"
import { fileSymbols, KIND_TAG } from "./symbols"
import { openAt, recordJump } from "../app/navHistory"
import { parseGoto } from "../editor/search"
import { indexToCol } from "../lsp/positions"
import type { SymbolEntry } from "../lsp/LspManager"
import type { CodeEditorRenderable } from "../editor/CodeEditorRenderable"
import type { TreeModel } from "./TreeModel"

function Highlighted({ text, positions, selected }: { text: string; positions: number[]; selected: boolean }) {
  const set = new Set(positions)
  const parts: { s: string; hit: boolean }[] = []
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i)
    const last = parts[parts.length - 1]
    if (last && last.hit === hit) last.s += text[i]
    else parts.push({ s: text[i]!, hit })
  }
  return (
    <text selectable={false} fg={selected ? colors.text : colors.dim}>
      {parts.map((p, i) =>
        p.hit ? (
          <span key={i} fg={colors.accent}>
            {p.s}
          </span>
        ) : (
          p.s
        ),
      )}
    </text>
  )
}

interface Item {
  key: string
  label: string
  positions: number[]
  detail?: string
  run: () => void | Promise<void>
}

/**
 * Ctrl+P. Plain text: files (recent first when empty). `@name`: symbols in this file.
 * `:42`: go to line. `#name`: symbols across the project (language server).
 */
export function FilePicker({ tree }: { tree: TreeModel }) {
  const ws = useWorkspace()
  const dims = useTerminalDimensions()
  const [initial] = useState(() => {
    const m = ws.ui.get().modal
    return m?.kind === "picker" ? (m.query ?? "") : ""
  })
  const [query, setQuery] = useState(initial)
  const [files, setFiles] = useState<string[] | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [sel, setSel] = useState(0)
  const [symbols, setSymbols] = useState<SymbolEntry[] | null>(null)
  const [wsSymbols, setWsSymbols] = useState<SymbolEntry[] | null>(null)
  const mode = query.startsWith("@") ? "symbol" : query.startsWith(":") ? "line" : query.startsWith("#") ? "workspace" : "file"
  const term = mode === "file" ? query : query.slice(1)
  const active = ws.buffers.active
  const rel = (p: string) => relative(ws.root, p).split(sep).join("/")

  useEffect(() => {
    let live = true
    void tree.files().then((r) => {
      if (!live) return
      setFiles(r.files)
      setTruncated(r.truncated)
    })
    return () => {
      live = false
    }
  }, [tree])

  // Symbols of the current file, loaded once when "@" is typed.
  useEffect(() => {
    if (mode !== "symbol" || symbols || !active) return
    void fileSymbols(ws, active.path, ws.buffers.textOf(active)).then(setSymbols)
  }, [mode, active?.id])

  // Project symbols ask the server as you type (debounced).
  useEffect(() => {
    if (mode !== "workspace" || !active || !ws.lsp?.hasServer(active.path) || term.length < 2) return setWsSymbols(null)
    const t = setTimeout(() => void ws.lsp!.workspaceSymbols(term, active.path).then(setWsSymbols), 200)
    return () => clearTimeout(t)
  }, [mode, term, active?.id])

  const close = () => ws.ui.set({ modal: null })
  const openFile = async (relPath: string) => {
    close()
    try {
      const abs = join(ws.root, relPath)
      recordJump(ws)
      await ws.buffers.open(abs)
      await tree.reveal(abs)
      ws.ui.set({ focus: "editor" })
    } catch (err) {
      ws.notify((err as Error).message, "warn")
    }
  }
  const jumpTo = (s: SymbolEntry) => {
    close()
    const line = s.path === active?.path ? (ws.buffers.textOf(active).split("\n")[s.line] ?? "") : ""
    const col = indexToCol(line, s.character)
    void openAt(ws, s.path, s.line, col, col + Bun.stringWidth(s.name.split(" ").pop() ?? ""))
  }

  const items: Item[] = useMemo(() => {
    if (mode === "line") {
      const ed = active?.textarea as CodeEditorRenderable | null | undefined
      if (!ed) return []
      const r = parseGoto(term || "x", ed.lineCount)
      if (typeof r === "string") return [{ key: "hint", label: term ? r : `Type a line number (1–${ed.lineCount})`, positions: [], run: () => {} }]
      return [{ key: "line", label: `Go to line ${r.row + 1}${r.col ? `, column ${r.col + 1}` : ""}`, positions: [], run: () => {
        close()
        recordJump(ws)
        ed.goTo(r.row, r.col)
        ws.buffers.onCursorChange(active!.id)
      } }]
    }
    if (mode === "symbol" || mode === "workspace") {
      const list = (mode === "symbol" ? symbols : wsSymbols) ?? []
      const names = list.map((s) => s.name)
      const ranked = term ? fuzzyFilter(term, names, 200) : names.map((n, i) => ({ item: n, positions: [], score: -i }))
      const used = new Set<number>()
      return ranked.map((m) => {
        // Names can repeat; take the next unused symbol with that name.
        const i = list.findIndex((s, j) => s.name === m.item && !used.has(j))
        used.add(i)
        const s = list[i]!
        const where = mode === "workspace" ? `${rel(s.path)}:${s.line + 1}` : `${s.container ? s.container + " · " : ""}line ${s.line + 1}`
        return { key: `${s.path}:${s.line}:${i}`, label: s.name, positions: m.positions, detail: `${KIND_TAG[s.kind] ?? ""} ${where}`.trim(), run: () => jumpTo(s) }
      })
    }
    if (!files) return []
    if (!term) {
      // Recently opened files first (not the current one), then the rest.
      const recent = ws.buffers.recent.filter((p) => p !== active?.path).map(rel).filter((r) => !r.startsWith(".."))
      const rest = files.filter((f) => !recent.includes(f))
      return [...recent, ...rest].slice(0, 200).map((f, i) => ({ key: f, label: f, positions: [], detail: i < recent.length ? "recent" : undefined, run: () => openFile(f) }))
    }
    return fuzzyFilter(term, files, 200).map((m) => ({ key: m.item, label: m.item, positions: m.positions, run: () => openFile(m.item) }))
  }, [mode, term, files, symbols, wsSymbols, active?.id])

  const listH = Math.max(3, Math.min(20, dims.height - 10))
  const start = Math.max(0, Math.min(sel - listH + 1, items.length - listH))
  const visible = items.slice(Math.max(0, start), Math.max(0, start) + listH)

  useKeyboard((key) => {
    let handled = true
    if (key.name === "escape" || (key.ctrl && key.name === "p")) close()
    else if (key.name === "up" || (key.ctrl && key.name === "k")) setSel((s) => Math.max(0, s - 1))
    else if (key.name === "down" || (key.ctrl && key.name === "n") || key.name === "tab") setSel((s) => Math.min(items.length - 1, s + 1))
    else if (key.name === "return") void items[sel]?.run()
    else handled = false
    if (handled) {
      key.preventDefault()
      key.stopPropagation()
    }
  })

  const status =
    mode === "file"
      ? files === null
        ? "Indexing…"
        : `${term ? items.length : files.length} of ${files.length} files${truncated ? " (index truncated)" : ""}   @ symbols · : line · # project symbols`
      : mode === "symbol"
        ? symbols === null
          ? "Reading symbols…"
          : `${items.length} symbols in ${active ? rel(active.path) : "no file"}`
        : mode === "workspace"
          ? !active || !ws.lsp?.hasServer(active.path)
            ? "Project symbols need a language server for the open file"
            : term.length < 2
              ? "Type at least 2 characters"
              : wsSymbols === null
                ? "Searching…"
                : `${items.length} symbols`
          : "Enter goes there"

  return (
    <Modal title="Go to file" width={90} height={listH + 6} onClose={close}>
      <input
        focused
        placeholder="File name · @symbol · :line · #project symbol"
        value={initial}
        backgroundColor={colors.bg}
        focusedBackgroundColor={colors.bg}
        textColor={colors.text}
        onInput={(v: string) => {
          setQuery(v)
          setSel(0)
        }}
      />
      <box height={1}>
        <text selectable={false} wrapMode="none" fg={colors.dim}>
          {status}
        </text>
      </box>
      <box
        flexDirection="column"
        flexGrow={1}
        onMouseScroll={(e) => {
          e.stopPropagation()
          const d = e.scroll?.direction === "up" ? -1 : e.scroll?.direction === "down" ? 1 : 0
          if (d) setSel((s) => Math.max(0, Math.min(items.length - 1, s + d)))
        }}
      >
        {visible.map((m, i) => {
          const idx = Math.max(0, start) + i
          return (
            <box
              key={m.key}
              height={1}
              flexDirection="row"
              backgroundColor={idx === sel ? colors.selectionBg : undefined}
              onMouseOver={() => setSel(idx)}
              onMouseDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                void m.run()
              }}
            >
              <box flexGrow={1} overflow="hidden">
                <Highlighted text={m.label} positions={m.positions} selected={idx === sel} />
              </box>
              {m.detail ? (
                // The detail (kind, line, path) keeps its width; a long name gives way instead.
                <box flexShrink={0}>
                  <text selectable={false} wrapMode="none" fg={colors.dim}>
                    {" " + m.detail}
                  </text>
                </box>
              ) : null}
            </box>
          )
        })}
      </box>
    </Modal>
  )
}

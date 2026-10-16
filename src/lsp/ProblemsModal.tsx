import { useState, useSyncExternalStore } from "react"
import { relative, sep } from "node:path"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { Modal } from "../app/Modal"
import { useWorkspace } from "../app/workspace"
import { ui as colors } from "../config/theme"
import { openAt } from "../app/navHistory"
import { indexToCol } from "./positions"
import { sendProblems } from "../ai/askAi"
import { closeModal } from "../app/modalStack"

const noLsp = { subscribe: () => () => {}, getSnapshot: () => 0 }

/** Ctrl+Alt+E: errors and warnings in open files. Enter jumps to one. */
export function ProblemsModal() {
  const ws = useWorkspace()
  const dims = useTerminalDimensions()
  useSyncExternalStore(ws.lsp?.subscribe ?? noLsp.subscribe, ws.lsp?.getSnapshot ?? noLsp.getSnapshot)
  const all = ws.lsp?.allDiagnostics() ?? []
  const [sel, setSel] = useState(0)
  const listH = Math.max(3, Math.min(20, dims.height - 8))
  const start = Math.max(0, Math.min(sel - listH + 1, all.length - listH))
  const close = () => closeModal(ws)

  const jump = async (i: number) => {
    const p = all[i]
    if (!p) return
    const open = ws.buffers.byPath(p.path)
    const line = (open ? ws.buffers.textOf(open) : "").split("\n")[p.diag.range.start.line] ?? ""
    const s = indexToCol(line, p.diag.range.start.character)
    const e = p.diag.range.end.line === p.diag.range.start.line ? indexToCol(line, p.diag.range.end.character) : s
    await openAt(ws, p.path, p.diag.range.start.line, s, Math.max(s, e))
  }

  useKeyboard((key) => {
    key.preventDefault()
    key.stopPropagation()
    if (key.name === "escape") close()
    else if (key.name === "down") setSel((s) => Math.min(all.length - 1, s + 1))
    else if (key.name === "up") setSel((s) => Math.max(0, s - 1))
    else if (key.name === "return") void jump(sel)
    else if (key.name === "f" && all.length) sendProblems(ws, { all: true })
  })

  const counts = ws.lsp?.counts() ?? { errors: 0, warnings: 0 }
  return (
    <Modal title={`Problems: ${counts.errors} errors, ${counts.warnings} warnings (open files)${all.length && ws.ai ? " · f: AI fix" : ""}`} width={Math.min(120, dims.width - 4)} height={listH + 4} onClose={close}>
      {all.length === 0 ? (
        <text selectable={false} fg={colors.dim}>
          {ws.lsp?.status() ? "No problems in open files." : "No language server running (open a TypeScript, Rust, Go or Python file)."}
        </text>
      ) : (
        all.slice(start, start + listH).map((p, i) => {
          const idx = start + i
          const sev = p.diag.severity ?? 1
          return (
            <box
              key={idx}
              height={1}
              flexDirection="row"
              overflow="hidden"
              backgroundColor={idx === sel ? colors.selectionBg : undefined}
              onMouseOver={() => setSel(idx)}
              onMouseDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                void jump(idx)
              }}
            >
              <text selectable={false} fg={sev === 1 ? colors.error : sev === 2 ? colors.warn : colors.accent}>
                {sev === 1 ? "● " : sev === 2 ? "▲ " : "i "}
              </text>
              <text selectable={false} fg={colors.accent}>
                {relative(ws.root, p.path).split(sep).join("/")}:{p.diag.range.start.line + 1}{" "}
              </text>
              <text selectable={false} wrapMode="none" fg={idx === sel ? colors.text : colors.dim}>
                {p.diag.message.split("\n")[0]}
              </text>
            </box>
          )
        })
      )}
    </Modal>
  )
}

import { useEffect, useState } from "react"
import { relative, sep } from "node:path"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { Modal } from "../app/Modal"
import { useWorkspace } from "../app/workspace"
import { ui as colors } from "../config/theme"
import { openAt } from "../app/navHistory"
import type { Location } from "./LspManager"
import { indexToCol } from "./positions"
import { closeModal } from "../app/modalStack"

/** A list of code locations (references). Enter opens one. */
export function LocationsModal({ title, locations }: { title: string; locations: Location[] }) {
  const ws = useWorkspace()
  const dims = useTerminalDimensions()
  const [sel, setSel] = useState(0)
  const [lines, setLines] = useState<Map<string, string[]>>(new Map())
  const listH = Math.max(3, Math.min(20, dims.height - 8))
  const start = Math.max(0, Math.min(sel - listH + 1, locations.length - listH))
  const close = () => closeModal(ws)

  // Load each file's text once to show the line and convert columns.
  useEffect(() => {
    let live = true
    void (async () => {
      const m = new Map<string, string[]>()
      for (const p of new Set(locations.map((l) => l.path))) {
        const open = ws.buffers.byPath(p)
        const text = open ? ws.buffers.textOf(open) : await Bun.file(p).text().catch(() => "")
        m.set(p, text.split("\n"))
      }
      if (live) setLines(m)
    })()
    return () => {
      live = false
    }
  }, [locations, ws])

  const jump = (i: number) => {
    const l = locations[i]
    if (!l) return
    const line = lines.get(l.path)?.[l.range.start.line] ?? ""
    const s = indexToCol(line, l.range.start.character)
    const e = l.range.end.line === l.range.start.line ? indexToCol(line, l.range.end.character) : s
    void openAt(ws, l.path, l.range.start.line, s, Math.max(s, e))
  }

  useKeyboard((key) => {
    key.preventDefault()
    key.stopPropagation()
    if (key.name === "escape") close()
    else if (key.name === "down") setSel((s) => Math.min(locations.length - 1, s + 1))
    else if (key.name === "up") setSel((s) => Math.max(0, s - 1))
    else if (key.name === "return") jump(sel)
  })

  return (
    <Modal title={title} width={Math.min(120, dims.width - 4)} height={listH + 4} onClose={close}>
      {locations.slice(start, start + listH).map((l, i) => {
        const idx = start + i
        const text = (lines.get(l.path)?.[l.range.start.line] ?? "").trim()
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
              jump(idx)
            }}
          >
            <text selectable={false} fg={colors.accent}>
              {relative(ws.root, l.path).split(sep).join("/")}:{l.range.start.line + 1}{" "}
            </text>
            <text selectable={false} wrapMode="none" fg={idx === sel ? colors.text : colors.dim}>
              {text}
            </text>
          </box>
        )
      })}
    </Modal>
  )
}

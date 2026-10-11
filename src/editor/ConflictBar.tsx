import { useState } from "react"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { structuredPatch } from "diff"
import { useWorkspace, type Workspace } from "../app/workspace"
import { HoverBox, Modal } from "../app/Modal"
import { ui as colors } from "../config/theme"
import type { Buffer } from "./BufferStore"
import { acceptConflict, gotoConflict, useConflicts } from "../git/conflictActions"

/** Resolve a disk/AI conflict. Each returns after updating the buffer. */
function resolve(ws: Workspace, buf: Buffer, how: "merge" | "disk" | "mine"): void {
  ws.ui.set({ modal: null, focus: "editor" })
  if (how === "merge") {
    if (ws.buffers.mergeConflict(buf.id)) ws.notify("Merged: your edits plus the change on disk (Ctrl+Z undoes)")
    else ws.notify("Both changed the same lines; compare and pick one", "warn")
  } else if (how === "disk") {
    void ws.buffers
      .reloadFromDisk(buf.id)
      .then((r) => ws.notify(r === "gone" ? "The file is no longer on disk; your version is kept (Ctrl+S saves it)" : "Using the version on disk (Ctrl+Z brings yours back)", r === "gone" ? "warn" : "info"))
      .catch((err: Error) => ws.notify(`Could not read the file: ${err.message}`, "error"))
  }
  else {
    ws.buffers.keepLocal(buf.id)
    ws.notify("Keeping your version; saving will overwrite the file")
  }
}

const Btn = ({ label, onPress, strong }: { label: string; onPress: () => void; strong?: boolean }) => (
  <HoverBox onPress={onPress} paddingX={1} bg={strong ? colors.warnBarBg : undefined} hoverBg={colors.warnBarHoverBg}>
    <text selectable={false} fg={strong ? colors.warn : colors.text}>
      {label}
    </text>
  </HoverBox>
)

/** Above a file whose control characters were dropped when it was read: saving would lose them. */
export function ControlCharsBar() {
  return (
    <box height={1} flexShrink={0} backgroundColor={colors.warnBarBg} paddingLeft={1} overflow="hidden">
      <text selectable={false} fg={colors.warn}>
        ⚠ This file has control characters (form feeds, escape codes…) the editor can't show; saving removes them.
      </text>
    </box>
  )
}

export function ConflictBar({ buf }: { buf: Buffer }) {
  const ws = useWorkspace()
  if (!buf.conflict) {
    return (
      <box height={1} flexShrink={0} backgroundColor={colors.warnBarBg} paddingLeft={1} overflow="hidden">
        <text selectable={false} fg={colors.warn}>
          {buf.deleted ? "⚠ Not on disk. Ctrl+S creates it." : "⚠ Changed on disk."}
        </text>
      </box>
    )
  }
  const canMerge = ws.buffers.mergePreview(buf.id) !== null
  return (
    // Wraps onto a second line in a narrow pane rather than hiding buttons.
    <box flexDirection="row" flexWrap="wrap" flexShrink={0} backgroundColor={colors.mergeBarBg}>
      <box paddingLeft={1} paddingRight={1} flexShrink={0}>
        <text selectable={false} fg={colors.warn}>
          ⚠ Changed on disk
        </text>
      </box>
      {canMerge ? <Btn strong label="Merge both" onPress={() => resolve(ws, buf, "merge")} /> : null}
      <Btn strong={!canMerge} label="Compare" onPress={() => ws.ui.set({ modal: { kind: "diff", bufId: buf.id } })} />
      <Btn label="Use disk" onPress={() => resolve(ws, buf, "disk")} />
      <Btn label="Keep mine" onPress={() => resolve(ws, buf, "mine")} />
    </box>
  )
}

/** Your unsaved text vs the file on disk, with the same three choices. */
export function DiffModal({ bufId }: { bufId: number }) {
  const ws = useWorkspace()
  const dims = useTerminalDimensions()
  const buf = ws.buffers.byId(bufId)
  const [top, setTop] = useState(0)
  const lines: { text: string; color: string }[] = []
  if (buf) {
    const patch = structuredPatch(buf.relPath, buf.relPath, ws.buffers.textOf(buf), buf.diskText, "", "", { context: 2 })
    for (const h of patch.hunks) {
      lines.push({ text: `@@ line ${h.newStart} @@`, color: colors.accent })
      for (const l of h.lines) {
        if (l.startsWith("\\")) continue
        lines.push({ text: l, color: l[0] === "+" ? colors.gitAdd : l[0] === "-" ? colors.gitDel : colors.dim })
      }
    }
  }
  const canMerge = buf ? ws.buffers.mergePreview(buf.id) !== null : false
  const viewH = Math.max(3, Math.min(lines.length || 1, dims.height - 9))
  const maxTop = Math.max(0, lines.length - viewH)
  const scroll = (d: number) => setTop((t) => Math.max(0, Math.min(maxTop, t + d)))

  useKeyboard((key) => {
    key.preventDefault()
    key.stopPropagation()
    if (!buf || key.name === "escape") return ws.ui.set({ modal: null })
    if (key.name === "m" && canMerge) resolve(ws, buf, "merge")
    else if (key.name === "d") resolve(ws, buf, "disk")
    else if (key.name === "k") resolve(ws, buf, "mine")
    else if (key.name === "up") scroll(-1)
    else if (key.name === "down") scroll(1)
    else if (key.name === "pageup") scroll(-viewH)
    else if (key.name === "pagedown" || key.name === "space") scroll(viewH)
  })
  if (!buf) return null

  return (
    <Modal title={`${buf.relPath}: yours (−) vs on disk (+)`} width={Math.min(110, dims.width - 4)} height={viewH + 6} onClose={() => ws.ui.set({ modal: null })}>
      <box
        flexDirection="column"
        height={viewH}
        onMouseScroll={(e) => {
          e.stopPropagation()
          scroll(e.scroll?.direction === "up" ? -3 : 3)
        }}
      >
        {lines.slice(top, top + viewH).map((l, i) => (
          <box key={top + i} height={1} overflow="hidden">
            <text selectable={false} fg={l.color}>
              {l.text || " "}
            </text>
          </box>
        ))}
      </box>
      <box height={1} />
      <box flexDirection="row" gap={1} height={1}>
        {canMerge ? <Btn strong label="[m] Merge both" onPress={() => resolve(ws, buf, "merge")} /> : null}
        <Btn label="[d] Use disk" onPress={() => resolve(ws, buf, "disk")} />
        <Btn label="[k] Keep mine" onPress={() => resolve(ws, buf, "mine")} />
        <text selectable={false} fg={colors.dim}>
          {canMerge ? "" : "same lines changed: pick one"}
          {maxTop ? " ↑↓ scroll" : ""}
        </text>
      </box>
    </Modal>
  )
}

/** Shown while the file has merge-conflict markers: count, accept buttons, next. */
export function MergeConflictBar({ bufId }: { bufId: number }) {
  const ws = useWorkspace()
  const list = useConflicts(bufId)
  if (!list.length) return null
  return (
    <box flexDirection="row" flexWrap="wrap" flexShrink={0} backgroundColor={colors.mergeBarBg}>
      <box paddingLeft={1} paddingRight={1} flexShrink={0}>
        <text selectable={false} fg={colors.warn}>
          ⚠ {list.length} merge conflict{list.length === 1 ? "" : "s"}
        </text>
      </box>
      <Btn strong label="Accept current (Alt+1)" onPress={() => acceptConflict(ws, "current")} />
      <Btn strong label="Accept incoming (Alt+2)" onPress={() => acceptConflict(ws, "incoming")} />
      <Btn label="Both (Alt+3)" onPress={() => acceptConflict(ws, "both")} />
      <Btn label="Next (Alt+F5)" onPress={() => gotoConflict(ws, 1)} />
    </box>
  )
}

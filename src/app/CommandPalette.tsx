import { useMemo, useState } from "react"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { Modal } from "./Modal"
import { useWorkspace, useCursorStyle } from "./workspace"
import { ui as colors } from "../config/theme"
import { commands, runCommand, type CommandId } from "../keymap/commands"
import type { buildBindings } from "../keymap/bindings"
import { fuzzyFilter } from "../files/fuzzy"
import { prettyKeys } from "../keymap/keys"
import { closeModal } from "./modalStack"

const pretty = prettyKeys

// Not useful from a list (they act on a selection or are pane-specific navigation).
const HIDDEN = new Set<CommandId>(["app.palette"])

/** F1: every command, searchable, with its shortcut. */
export function CommandPalette({ bindings }: { bindings: ReturnType<typeof buildBindings> }) {
  const cursorStyle = useCursorStyle()
  const ws = useWorkspace()
  const dims = useTerminalDimensions()
  const [query, setQuery] = useState("")
  const [sel, setSel] = useState(0)

  const items = useMemo(() => {
    const keys = new Map<CommandId, string>()
    for (const layer of ["global", "editor", "tree", "ai"] as const)
      for (const [k, id] of bindings[layer]) if (!keys.has(id as CommandId)) keys.set(id as CommandId, pretty(k))
    return (Object.keys(commands) as CommandId[])
      .filter((id) => !HIDDEN.has(id))
      .map((id) => ({ id, title: commands[id].title, key: keys.get(id) ?? "" }))
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [bindings])
  const titles = useMemo(() => items.map((i) => i.title), [items])
  const matches = useMemo(() => fuzzyFilter(query, titles, 100), [query, titles])
  const byTitle = useMemo(() => new Map(items.map((i) => [i.title, i])), [items])

  const listH = Math.max(3, Math.min(18, dims.height - 8))
  const start = Math.max(0, Math.min(sel - listH + 1, matches.length - listH))
  const close = () => closeModal(ws)
  const choose = (title: string | undefined) => {
    const item = title ? byTitle.get(title) : undefined
    if (!item) return
    close()
    void runCommand(ws, item.id)
  }

  useKeyboard((key) => {
    let handled = true
    if (key.name === "escape") close()
    else if (key.name === "return") choose(matches[sel]?.item)
    else if (key.name === "down") setSel((s) => Math.min(matches.length - 1, s + 1))
    else if (key.name === "up") setSel((s) => Math.max(0, s - 1))
    else handled = false
    if (handled) {
      key.preventDefault()
      key.stopPropagation()
    }
  })

  return (
    <Modal title="Commands" width={Math.min(72, dims.width - 4)} height={listH + 4} onClose={close}>
      <input
        cursorStyle={cursorStyle}
        focused
        placeholder="Type a command…"
        backgroundColor={colors.bg}
        focusedBackgroundColor={colors.bg}
        textColor={colors.text}
        onInput={(v: string) => {
          setQuery(v)
          setSel(0)
        }}
      />
      <box flexDirection="column" flexGrow={1}>
        {matches.slice(Math.max(0, start), Math.max(0, start) + listH).map((m, i) => {
          const idx = Math.max(0, start) + i
          const item = byTitle.get(m.item)!
          return (
            <box
              key={item.id}
              height={1}
              flexDirection="row"
              backgroundColor={idx === sel ? colors.selectionBg : undefined}
              onMouseOver={() => setSel(idx)}
              onMouseDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                choose(m.item)
              }}
            >
              <box flexGrow={1} overflow="hidden">
                <text selectable={false} fg={idx === sel ? colors.text : colors.dim}>
                  {item.title}
                </text>
              </box>
              <text selectable={false} fg={colors.accent}>
                {item.key}
              </text>
            </box>
          )
        })}
      </box>
    </Modal>
  )
}

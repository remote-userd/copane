import { useEffect, useMemo, useState } from "react"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { Modal } from "../app/Modal"
import { useWorkspace } from "../app/workspace"
import { ui as colors } from "../config/theme"
import { fuzzyFilter } from "../files/fuzzy"
import type { Branch } from "./repo"

const CREATE = "\u0000create"

/** Ctrl+Alt+B: switch to a branch (fuzzy), or create one from what you typed. */
export function BranchPicker() {
  const ws = useWorkspace()
  const dims = useTerminalDimensions()
  const repo = ws.git?.repo ?? null
  const [branches, setBranches] = useState<Branch[] | null>(null)
  const [query, setQuery] = useState("")
  const [sel, setSel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<(() => void) | null>(null)
  const close = () => ws.ui.set({ modal: null })

  useEffect(() => {
    void repo?.branches().then(setBranches)
  }, [repo])

  const names = branches?.map((b) => b.name) ?? []
  const matches = useMemo(() => fuzzyFilter(query.trim(), names, 100).map((m) => m.item), [query, branches])
  const name = query.trim()
  const canCreate = name && !names.includes(name) && /^[^\s~^:?*[\\]+$/.test(name)
  const items = [...matches, ...(canCreate ? [CREATE] : [])]

  const run = async (item: string | undefined) => {
    if (!item || !repo) return
    const create = item === CREATE
    const target = create ? name : item
    if (!create && branches?.find((b) => b.name === target)?.current) return close()
    const act = async () => {
      setError(null)
      const err = create ? await repo.createBranch(target) : await repo.switchTo(target)
      if (err) return setError(err)
      await ws.git!.afterChange()
      close()
      ws.notify(create ? `Created and switched to ${target}` : `Switched to ${target}`)
    }
    // Unsaved edits would be lost or block the switch: offer to save first.
    const dirty = ws.buffers.list().filter((b) => b.dirty)
    if (dirty.length && !create) {
      setConfirm(() => async () => {
        for (const b of dirty) await ws.buffers.save(b.id)
        await act()
      })
      return
    }
    await act()
  }

  useKeyboard((key) => {
    if (confirm) {
      key.preventDefault()
      key.stopPropagation()
      const c = confirm
      setConfirm(null)
      if (key.name === "y") void c()
      return
    }
    let handled = true
    if (key.name === "escape") close()
    else if (key.name === "return") void run(items[sel])
    else if (key.name === "down") setSel((s) => Math.min(items.length - 1, s + 1))
    else if (key.name === "up") setSel((s) => Math.max(0, s - 1))
    else handled = false
    if (handled) {
      key.preventDefault()
      key.stopPropagation()
    }
  })

  const listH = Math.max(3, Math.min(14, dims.height - 9))
  const start = Math.max(0, Math.min(sel - listH + 1, items.length - listH))
  return (
    <Modal title="Switch branch" width={Math.min(64, dims.width - 4)} height={listH + 6} onClose={close}>
      <input
        focused={!confirm}
        placeholder="Branch name (type a new one to create it)"
        backgroundColor={colors.bg}
        focusedBackgroundColor={colors.bg}
        textColor={colors.text}
        onInput={(v: string) => {
          setQuery(v)
          setSel(0)
          setError(null)
        }}
      />
      <box flexDirection="column" flexGrow={1}>
        {branches === null ? (
          <text fg={colors.dim}>Loading…</text>
        ) : (
          items.slice(start, start + listH).map((item, i) => {
            const idx = start + i
            const b = branches.find((x) => x.name === item)
            return (
              <box
                key={item}
                height={1}
                flexDirection="row"
                backgroundColor={idx === sel ? colors.selectionBg : undefined}
                onMouseOver={() => setSel(idx)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  void run(item)
                }}
              >
                <text selectable={false} wrapMode="none" fg={item === CREATE ? colors.ok : b?.current ? colors.accent : colors.text}>
                  {item === CREATE ? `+ Create branch "${name}"` : `${b?.current ? "● " : "  "}${item}`}
                </text>
              </box>
            )
          })
        )}
      </box>
      <box height={1}>
        <text selectable={false} fg={confirm ? colors.warn : error ? colors.error : colors.dim}>
          {confirm ? "You have unsaved files. Save them all and switch? (y/n)" : (error ?? "Enter switches · Esc closes")}
        </text>
      </box>
    </Modal>
  )
}

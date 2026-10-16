import { useEffect, useMemo, useState } from "react"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { Modal } from "../app/Modal"
import { useWorkspace, useCursorStyle } from "../app/workspace"
import type { Modal as ModalState } from "../app/state"
import { ui as colors } from "../config/theme"
import { fuzzyFilter } from "../files/fuzzy"
import type { Branch } from "./repo"

const CREATE = "\u0000create"

/**
 * Ctrl+Alt+B: switch to a branch (fuzzy), or create one from what you typed; Shift+Delete deletes
 * the selected one. In "delete" mode (the Delete a branch command), Enter deletes.
 */
export function BranchPicker({ mode = "switch", back }: { mode?: "switch" | "delete"; back?: ModalState }) {
  const cursorStyle = useCursorStyle()
  const ws = useWorkspace()
  const dims = useTerminalDimensions()
  const repo = ws.git?.repo ?? null
  // Several repositories: say which one (Source Control's tab, else the open file's).
  const shown = ws.git && ws.git.list().length > 1 ? ws.git.current() : null
  const inRepo = shown ? ` in ${ws.git!.name(shown)}` : ""
  const [branches, setBranches] = useState<Branch[] | null>(null)
  const [query, setQuery] = useState("")
  const [sel, setSel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ text: string; yes: () => Promise<void> | void } | null>(null)
  const close = () => ws.ui.set({ modal: back ?? null })

  const load = () => void repo?.branches().then(setBranches)
  useEffect(load, [repo])

  const deleting = mode === "delete"
  // The current branch can't be deleted, so delete mode leaves it out.
  const names = (branches ?? []).filter((b) => !deleting || !b.current).map((b) => b.name)
  const matches = useMemo(() => fuzzyFilter(query.trim(), names, 100).map((m) => m.item), [query, branches])
  const name = query.trim()
  const canCreate = !deleting && name && !names.includes(name) && /^[^\s~^:?*[\\]+$/.test(name)
  const items = [...matches, ...(canCreate ? [CREATE] : [])]

  /** Delete a branch after a confirmation; git's refusal of unmerged work leads to a second, forcing one. */
  const remove = (item: string | undefined) => {
    if (!item || item === CREATE || !repo) return
    if (branches?.find((b) => b.name === item)?.current) return setError("That's the current branch: switch to another one first")
    setConfirm({
      text: `Delete branch ${item}? (y/n)`,
      yes: async () => {
        const r = await repo.deleteBranch(item)
        if ("ok" in r) return deleted(item)
        if (!r.unmerged) return setError(r.error)
        setConfirm({
          text: `${item} has commits that aren't merged anywhere. Delete it and lose them? (y/n)`,
          yes: async () => {
            const forced = await repo.deleteBranch(item, true)
            if ("ok" in forced) deleted(item)
            else setError(forced.error)
          },
        })
      },
    })
  }
  const deleted = (item: string) => {
    ws.notify(`Deleted branch ${item}`)
    setError(null)
    setSel(0)
    load()
    void ws.git?.afterChange()
  }

  const run = async (item: string | undefined) => {
    if (!item || !repo) return
    if (deleting) return remove(item)
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
      setConfirm({
        text: "You have unsaved files. Save them all and switch? (y/n)",
        yes: async () => {
          try {
            for (const b of dirty) await ws.buffers.save(b.id)
          } catch (err) {
            // Not switching with unsaved work: say why (a file changed on disk, no permission…).
            return ws.notify(`Not switching: ${(err as Error).message}`, "warn")
          }
          await act()
        },
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
      if (key.name === "y") void c.yes()
      return
    }
    let handled = true
    if (key.name === "escape") close()
    else if (key.name === "return") void run(items[sel])
    else if (key.name === "delete" && key.shift) remove(items[sel])
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
    <Modal title={`${deleting ? "Delete branch" : "Switch branch"}${inRepo}`} width={Math.min(64, dims.width - 4)} height={listH + 6} onClose={close}>
      <input
        cursorStyle={cursorStyle}
        focused={!confirm}
        placeholder={deleting ? "Branch to delete" : "Branch name (type a new one to create it)"}
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
                  // Right-click deletes, like the × at the end of the row.
                  if (e.button === 2) remove(item)
                  else void run(item)
                }}
              >
                <text selectable={false} wrapMode="none" flexGrow={1} fg={item === CREATE ? colors.ok : b?.current ? colors.accent : colors.text}>
                  {item === CREATE ? `+ Create branch "${name}"` : `${b?.current ? "● " : "  "}${item}`}
                </text>
                {idx === sel && item !== CREATE && !b?.current && !deleting ? (
                  <box
                    flexShrink={0}
                    paddingLeft={1}
                    paddingRight={1}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      remove(item)
                    }}
                  >
                    <text selectable={false} fg={colors.error}>
                      × delete
                    </text>
                  </box>
                ) : null}
              </box>
            )
          })
        )}
      </box>
      <box height={1}>
        <text selectable={false} fg={confirm ? colors.warn : error ? colors.error : colors.dim}>
          {confirm ? confirm.text : (error ?? (deleting ? "Enter or click deletes · Esc closes" : "Enter switches · Shift+Del or right-click deletes · Esc"))}
        </text>
      </box>
    </Modal>
  )
}

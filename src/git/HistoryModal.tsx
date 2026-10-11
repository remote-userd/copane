import { useEffect, useState } from "react"
import { openFile } from "../app/navHistory"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { Modal } from "../app/Modal"
import { useWorkspace } from "../app/workspace"
import { ui as colors } from "../config/theme"
import type { LogEntry } from "./repo"

/**
 * File history (commits touching a file, with that file's diff per commit) or a single
 * commit (from blame). ↑↓ choose, PgUp/PgDn scroll, y copies the sha, Enter opens the file.
 */
export function HistoryModal({ path, sha }: { path: string | null; sha?: string }) {
  const ws = useWorkspace()
  const dims = useTerminalDimensions()
  const repo = ws.git?.repo ?? null
  const [commits, setCommits] = useState<LogEntry[] | null>(null)
  const [sel, setSel] = useState(0)
  const [diff, setDiff] = useState<string[]>([])
  const [top, setTop] = useState(0)
  const close = () => ws.ui.set({ modal: null })

  useEffect(() => {
    if (!repo) return setCommits([])
    if (sha) setCommits([{ sha, author: "", when: "", subject: "" }])
    else void repo.log(path ?? undefined).then(setCommits)
  }, [repo, path, sha])

  const current = commits?.[sel]
  useEffect(() => {
    let live = true
    setTop(0)
    if (!repo || !current) return setDiff([])
    void repo.show(current.sha, sha ? undefined : (path ?? undefined)).then((d) => live && setDiff(d.split("\n")))
    return () => {
      live = false
    }
  }, [repo, current?.sha, path, sha])

  const viewH = Math.max(4, dims.height - 7)
  const maxTop = Math.max(0, diff.length - viewH)
  useKeyboard((key) => {
    key.preventDefault()
    key.stopPropagation()
    if (key.name === "escape" || key.name === "q") close()
    else if (key.name === "down" || key.name === "j") setSel((s) => Math.min((commits?.length ?? 1) - 1, s + 1))
    else if (key.name === "up" || key.name === "k") setSel((s) => Math.max(0, s - 1))
    else if (key.name === "pagedown" || key.name === "space") setTop((t) => Math.min(maxTop, t + viewH - 2))
    else if (key.name === "pageup") setTop((t) => Math.max(0, t - viewH + 2))
    else if (key.name === "y" && current) void ws.clipboard.copy(current.sha).then(() => ws.notify(`Copied ${current.sha}`))
    else if (key.name === "return" && path) {
      close()
      void openFile(ws, path)
    }
  })

  const color = (l: string) =>
    l.startsWith("+++") || l.startsWith("---")
      ? colors.headerFg
      : l.startsWith("+")
        ? colors.gitAdd
        : l.startsWith("-")
          ? colors.gitDel
          : l.startsWith("@@")
            ? colors.accent
            : l.startsWith("commit ") || l.startsWith("Author:") || l.startsWith("Date:")
              ? colors.warn
              : colors.text
  const w = Math.min(dims.width - 4, 170)
  const listW = sha ? 0 : Math.min(48, Math.floor(w * 0.35))
  const title = sha ? `Commit ${sha.slice(0, 8)}` : `History: ${path ? repo?.rel(path) : "repository"}${commits ? ` (${commits.length})` : ""}`
  const listTop = Math.max(0, Math.min(sel - viewH + 1, (commits?.length ?? 0) - viewH))

  return (
    <Modal title={`${title}   ↑↓ commit · PgDn scroll · y copy sha · Esc`} width={w} height={viewH + 4} onClose={close}>
      <box flexDirection="row" flexGrow={1} gap={2}>
        {listW ? (
          <box width={listW} flexShrink={0} flexDirection="column">
            {commits === null ? (
              <text fg={colors.dim}>Loading…</text>
            ) : commits.length === 0 ? (
              <text fg={colors.dim}>No commits for this file yet.</text>
            ) : (
              commits.slice(listTop, listTop + viewH).map((c, i) => {
                const idx = listTop + i
                return (
                  <box
                    key={c.sha}
                    height={1}
                    flexDirection="row"
                    overflow="hidden"
                    backgroundColor={idx === sel ? colors.selectionBg : undefined}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setSel(idx)
                    }}
                  >
                    <text selectable={false} fg={colors.warn}>
                      {c.sha.slice(0, 7)}{" "}
                    </text>
                    <text selectable={false} wrapMode="none" fg={idx === sel ? colors.text : colors.dim}>
                      {c.subject}
                    </text>
                  </box>
                )
              })
            )}
          </box>
        ) : null}
        <box
          flexGrow={1}
          flexDirection="column"
          overflow="hidden"
          onMouseScroll={(e) => {
            e.stopPropagation()
            setTop((t) => Math.max(0, Math.min(maxTop, t + (e.scroll?.direction === "up" ? -3 : 3))))
          }}
        >
          {current && !sha && current.author ? (
            <box height={1}>
              <text selectable={false} fg={colors.headerFg}>
                {current.author} · {current.when}
              </text>
            </box>
          ) : null}
          {diff.slice(top, top + viewH).map((l, i) => (
            <box key={top + i} height={1} overflow="hidden">
              <text selectable={false} wrapMode="none" fg={color(l)}>
                {l || " "}
              </text>
            </box>
          ))}
        </box>
      </box>
    </Modal>
  )
}

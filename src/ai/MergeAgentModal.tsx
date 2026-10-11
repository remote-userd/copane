import { useEffect, useState } from "react"
import { openFile } from "../app/navHistory"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { join } from "node:path"
import { HoverBox, Modal } from "../app/Modal"
import { useWorkspace, type Workspace } from "../app/workspace"
import { ui as colors } from "../config/theme"
import { GitRepo, type WorktreeChange } from "../git/repo"
import { colorDiff, type DiffLine } from "../git/SourceControlPanel"

const LETTER_COLOR = { A: colors.ok, M: colors.warn, D: colors.error } as const

/**
 * Bring a worktree agent's work back: every file it changed since its branch split off
 * (committed or not) with its diff, then merge it into your branch (m) or throw it away (d).
 */
export function MergeAgentModal({ sessionId }: { sessionId: number }) {
  const ws = useWorkspace()
  const dims = useTerminalDimensions()
  const session = ws.agents?.session(sessionId)
  const repo = ws.git?.repo ?? null
  const agent = session ? new GitRepo(session.cwd) : null
  const [base, setBase] = useState<string | null>(null)
  const [changes, setChanges] = useState<WorktreeChange[] | null>(null)
  const [sel, setSel] = useState(0)
  const [diff, setDiff] = useState<DiffLine[]>([])
  const [top, setTop] = useState(0)
  const [status, setStatus] = useState<{ text: string; kind: "info" | "error" | "busy" } | null>(null)
  const [confirm, setConfirm] = useState<{ text: string; yes: () => void } | null>(null)
  const close = () => ws.ui.set({ modal: null })
  const change = changes?.[Math.min(sel, changes.length - 1)]

  useEffect(() => {
    if (!session?.branch || !repo || !agent) return
    let live = true
    void (async () => {
      const b = await repo.mergeBase(session.branch!)
      if (!live) return
      if (!b) return setStatus({ text: `Can't find where ${session.branch} split off`, kind: "error" })
      setBase(b)
      const list = await agent.changesSince(b)
      if (live) setChanges(list)
    })()
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, repo])

  useEffect(() => {
    setTop(0)
    if (!change || !base || !agent) return setDiff([])
    let live = true
    void agent.diffSince(base, change).then((d) => live && setDiff(colorDiff(d)))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [change?.rel, base])

  const merge = async () => {
    if (!session?.branch || !repo || !agent) return
    // The agent must not write while its work is committed and merged: stop its CLI first.
    setStatus({ text: "Stopping the agent, then merging…", kind: "busy" })
    await ws.agents?.stop(sessionId)
    const err = await agent.commitAll(`Work from ${session.name}`)
    if (err) return setStatus({ text: `Couldn't commit the agent's leftover work: ${err}`, kind: "error" })
    const r = await repo.merge(session.branch)
    await ws.git?.afterChange()
    if ("error" in r) return setStatus({ text: `Merge failed: ${r.error}`, kind: "error" })
    if ("conflicts" in r) {
      close()
      return ws.notify(`Merge has conflicts in ${r.conflicts} file${r.conflicts === 1 ? "" : "s"}: resolve them with the bar in each file (Alt+1/2/3), then commit`, "warn")
    }
    afterMerge(ws, sessionId, session.cwd, session.branch, changes?.length ?? 0)
  }

  const discard = () => {
    if (!session?.branch || !repo) return
    const n = changes?.length ?? 0
    setConfirm({
      text: `Throw away ${n} changed file${n === 1 ? "" : "s"}, the worktree and branch ${session.branch} for good? (y/n)`,
      yes: async () => {
        await ws.agents?.stop(sessionId)
        const err = await repo.removeWorktree(session.cwd, true)
        if (err) return setStatus({ text: `Couldn't remove the worktree: ${err}`, kind: "error" })
        await repo.deleteBranch(session.branch!, true)
        ws.agents?.close(sessionId)
        close()
        ws.notify(`Discarded ${session.name}'s work (${session.branch})`)
      },
    })
  }

  const open = () => {
    if (!change || !session || change.status === "D") return
    close()
    void openFile(ws, join(session.cwd, change.rel))
  }

  const viewH = dims.height - 8
  const maxTop = Math.max(0, diff.length - viewH)
  useKeyboard((key) => {
    key.preventDefault()
    key.stopPropagation()
    if (confirm) {
      const c = confirm
      setConfirm(null)
      if (key.name === "y") c.yes()
      return
    }
    const n = changes?.length ?? 0
    if (key.name === "escape") close()
    else if (key.name === "down" || key.name === "j") setSel((i) => Math.min(Math.max(0, n - 1), i + 1))
    else if (key.name === "up" || key.name === "k") setSel((i) => Math.max(0, i - 1))
    else if (key.name === "pagedown") setTop((t) => Math.min(maxTop, t + viewH))
    else if (key.name === "pageup") setTop((t) => Math.max(0, t - viewH))
    else if (key.name === "return") open()
    else if (key.name === "m" && n) void merge()
    else if (key.name === "d") discard()
  })

  if (!session?.branch) {
    return (
      <Modal title="Review & merge" height={6} onClose={close}>
        <text fg={colors.dim}>This agent doesn't work in its own git worktree, so there is nothing to merge: its changes are already in your project.</text>
      </Modal>
    )
  }
  const w = Math.min(dims.width - 4, 170)
  const leftW = Math.max(28, Math.floor(w * 0.3))
  const into = ws.git?.branch?.name ?? "your branch"
  const btn = (label: string, run: () => void) => (
    <HoverBox onPress={run} paddingX={1} bg={colors.segmentBg}>
      <text selectable={false} fg={colors.text}>
        {label}
      </text>
    </HoverBox>
  )
  return (
    <Modal title={`Review & merge ${session.name} (${session.branch}) into ${into}`} width={w} height={dims.height - 2} onClose={close}>
      <box flexDirection="row" flexGrow={1} gap={2}>
        <box width={leftW} flexShrink={0} flexDirection="column">
          <box flexDirection="row" gap={1} height={1}>
            {btn("Merge (m)", () => void merge())}
            {btn("Discard (d)", discard)}
          </box>
          <box height={1} />
          {changes === null ? (
            <text selectable={false} fg={colors.dim}>
              Reading the agent's changes…
            </text>
          ) : changes.length === 0 ? (
            <text selectable={false} fg={colors.dim}>
              No changes yet: the agent hasn't changed any files.
            </text>
          ) : (
            changes.map((c, i) => (
              <box
                key={c.rel}
                height={1}
                flexDirection="row"
                overflow="hidden"
                backgroundColor={i === sel ? colors.selectionBg : undefined}
                onMouseDown={() => setSel(i)}
              >
                <text selectable={false} fg={LETTER_COLOR[c.status]}>
                  {c.status + " "}
                </text>
                <text selectable={false} wrapMode="none" truncate fg={colors.text}>
                  {c.rel}
                </text>
              </box>
            ))
          )}
        </box>
        <box
          flexGrow={1}
          flexDirection="column"
          overflow="hidden"
          onMouseScroll={(e) => {
            e.stopPropagation()
            setTop((t) => Math.max(0, Math.min(maxTop, t + (e.scroll?.direction === "up" ? -3 : 3))))
          }}
        >
          {diff.slice(top, top + viewH).map((d, i) => (
            <box key={top + i} height={1} overflow="hidden">
              <text selectable={false} wrapMode="none" fg={d.color}>
                {d.text || " "}
              </text>
            </box>
          ))}
        </box>
      </box>
      <box height={1} flexDirection="row" overflow="hidden">
        <text selectable={false} fg={confirm ? colors.warn : status?.kind === "error" ? colors.error : status?.kind === "busy" ? colors.warn : colors.dim}>
          {confirm?.text ?? status?.text ?? "↑↓ file · Enter open · m merge into your branch · d discard · Esc close"}
        </text>
      </box>
    </Modal>
  )
}

/** Merged: offer to clean up the worktree, its branch and the tab. */
function afterMerge(ws: Workspace, sessionId: number, cwd: string, branch: string, files: number): void {
  const repo = ws.git?.repo
  ws.ui.set({
    modal: {
      kind: "confirm",
      title: "Merged",
      body: `Merged ${files} changed file${files === 1 ? "" : "s"} from ${branch}. Remove the worktree and the branch, and close the agent's tab?`,
      options: [
        {
          key: "r",
          label: "Remove and close",
          run: async () => {
            ws.ui.set({ modal: null })
            ws.agents?.close(sessionId)
            // Everything was committed and merged: a clean removal. Anything new since (the
            // agent was stopped first, but an editor tab could have saved there) keeps it.
            const err = await repo?.removeWorktree(cwd)
            if (!err) await repo?.deleteBranch(branch)
            ws.notify(err ? `Merged; worktree kept: ${err}` : `Merged ${branch} and removed its worktree`, err ? "warn" : "info")
          },
        },
        {
          key: "k",
          label: "Keep them",
          run: () => {
            ws.ui.set({ modal: null })
            ws.agents?.recount(sessionId)
            ws.notify(`Merged ${branch}`)
          },
        },
      ],
    },
  })
}

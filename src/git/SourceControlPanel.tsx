import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react"
import { basename } from "node:path"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { HoverBox, Modal } from "../app/Modal"
import { useWorkspace, type Workspace } from "../app/workspace"
import { ui as colors } from "../config/theme"
import { openAt } from "../app/navHistory"
import type { StatusEntry } from "./repo"
import { sendChangesForReview } from "../ai/askAi"

/**
 * Source control (Ctrl+Alt+D): conflicts, staged and unstaged files with a diff of the
 * selection, a commit message, commit / amend / AI message, push / pull, branch switch.
 */

const none = { subscribe: () => () => {}, getSnapshot: () => 0 }
/** The message being written survives closing the panel. */
let draft = ""
/** Tests: no message left over from another test. */
export function resetCommitDraft(): void {
  draft = ""
}

type Section = "conflict" | "staged" | "changes"
interface Row {
  section: Section
  entry: StatusEntry
}

const LETTER = (e: StatusEntry, section: Section) => {
  if (section === "conflict") return "!"
  if (e.untracked) return "U"
  const c = section === "staged" ? e.x : e.y
  return c === "?" ? "U" : c
}
const letterColor = (l: string) => (l === "M" ? colors.warn : l === "D" || l === "!" ? colors.error : colors.ok)

export interface DiffLine {
  text: string
  color: string
  line: number | null
}

export function colorDiff(raw: string): DiffLine[] {
  const out: DiffLine[] = []
  let n = 0
  for (const l of raw.split("\n")) {
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(l)
    if (h) {
      n = Number(h[1]) - 1
      out.push({ text: l, color: colors.accent, line: n })
    } else if (l.startsWith("+")) out.push({ text: l, color: colors.gitAdd, line: n++ })
    else if (l.startsWith("-")) out.push({ text: l, color: colors.gitDel, line: null })
    else if (l.startsWith("\\")) continue
    else out.push({ text: l, color: colors.dim, line: l ? n++ : null })
  }
  while (out.length && !out.at(-1)!.text) out.pop()
  return out
}

/** Ask the AI CLI (`claude -p`) for a commit message from the staged diff. */
export async function aiCommitMessage(ws: Workspace): Promise<string | { error: string }> {
  const cmd = ws.config.ai.command
  if (!ws.config.git.aiCommitMessage) return { error: "AI commit messages are off (git.aiCommitMessage)" }
  if (basename(cmd) !== "claude") return { error: `AI messages need claude as ai.command (now ${cmd})` }
  const diff = await ws.git!.repo!.stagedDiff()
  if (!diff.trim()) return { error: "Stage something first" }
  const prompt =
    "Write a git commit message for the staged diff on stdin. First line: imperative summary under 72 characters. " +
    "Then a blank line and a few short lines only if the change needs explaining. Output only the message, no quotes or code fences."
  try {
    const p = Bun.spawn([cmd, "-p", prompt], { cwd: ws.root, stdin: new TextEncoder().encode(diff), stdout: "pipe", stderr: "pipe" })
    const timer = setTimeout(() => p.kill(), 90_000)
    const [out, code] = await Promise.all([Bun.readableStreamToText(p.stdout), p.exited])
    clearTimeout(timer)
    const msg = out.trim().replace(/^```\w*\n?|```$/g, "").trim()
    return code === 0 && msg ? msg : { error: "The AI did not return a message" }
  } catch (err) {
    return { error: (err as Error).message }
  }
}

export function SourceControlPanel() {
  const ws = useWorkspace()
  const git = ws.git
  const repo = git?.repo ?? null
  const dims = useTerminalDimensions()
  useSyncExternalStore(git?.subscribe ?? none.subscribe, git?.getSnapshot ?? none.getSnapshot)
  const entries = git?.entries ?? []
  const rows: Row[] = [
    ...entries.filter((e) => e.conflict).map((entry) => ({ section: "conflict" as const, entry })),
    ...entries.filter((e) => e.staged).map((entry) => ({ section: "staged" as const, entry })),
    ...entries.filter((e) => e.unstaged).map((entry) => ({ section: "changes" as const, entry })),
  ]
  const counts = { conflict: 0, staged: 0, changes: 0 }
  for (const r of rows) counts[r.section]++

  const [sel, setSel] = useState(0)
  const [focus, setFocus] = useState<"list" | "message">(rows.some((r) => r.section === "staged") ? "message" : "list")
  const [message, setMessage] = useState(draft)
  const [inputKey, setInputKey] = useState(0)
  const [status, setStatus] = useState<{ text: string; kind: "info" | "error" | "busy" } | null>(null)
  const [confirm, setConfirm] = useState<{ text: string; yes: () => void } | null>(null)
  const [diff, setDiff] = useState<DiffLine[]>([])
  const [top, setTop] = useState(0)
  const row = rows[Math.min(sel, rows.length - 1)]

  useEffect(() => {
    draft = message
  }, [message])

  // Diff of the selected entry.
  useEffect(() => {
    let live = true
    setTop(0)
    if (!row || !repo) return setDiff([])
    const staged = row.section === "staged"
    void repo.diff(row.entry.path, staged, row.entry.untracked && !staged).then((d) => live && setDiff(colorDiff(d)))
    return () => {
      live = false
    }
  }, [row?.entry.path, row?.section, git?.getSnapshot(), repo])

  const close = () => ws.ui.set({ modal: null })
  const setMsg = (m: string) => {
    setMessage(m)
    setInputKey((k) => k + 1) // remount the input with the new text
  }
  const busy = (text: string) => setStatus({ text, kind: "busy" })
  const fail = (text: string) => setStatus({ text, kind: "error" })
  const done = async (text: string) => {
    await git?.afterChange()
    setStatus({ text, kind: "info" })
  }

  const toggleStage = async (r: Row | undefined) => {
    if (!r || !repo) return
    const err = r.section === "staged" ? await repo.unstage([r.entry.path]) : await repo.stage([r.entry.path])
    if (err) return fail(err)
    await done(`${r.section === "staged" ? "Unstaged" : "Staged"} ${r.entry.rel}`)
  }

  const commit = async (amend = false) => {
    if (!repo) return
    const msg = message.trim() || (amend ? await repo.lastMessage() : "")
    if (!msg) {
      setFocus("message")
      return fail("Write a commit message first")
    }
    if (!amend && counts.staged === 0) {
      if (counts.changes === 0) return fail("Nothing to commit")
      return setConfirm({
        text: "Nothing staged. Stage all changes and commit? (y/n)",
        yes: async () => {
          const err = await repo.stageAll()
          if (err) return fail(err)
          await finishCommit(msg, false)
        },
      })
    }
    await finishCommit(msg, amend)
  }
  const finishCommit = async (msg: string, amend: boolean) => {
    busy(amend ? "Amending…" : "Committing…")
    const r = await repo!.commit(msg, amend)
    if ("error" in r) return fail(r.error)
    setMsg("")
    await done(`${amend ? "Amended" : "Committed"} ${r.sha}`)
    ws.notify(`${amend ? "Amended" : "Committed"} ${r.sha}: ${msg.split("\n")[0]}`)
  }

  const push = async () => {
    if (!repo) return
    busy("Pushing…")
    const r = await repo.push((l) => busy(`Pushing… ${l}`))
    if ("ok" in r) return done("Pushed")
    if (r.noUpstream && git?.branch) {
      const branch = git.branch.name
      return setConfirm({
        text: `Branch ${branch} has no upstream. Publish it to the remote? (y/n)`,
        yes: async () => {
          busy("Publishing…")
          const err = await repo.pushSetUpstream(branch, (l) => busy(`Publishing… ${l}`))
          if (err) fail(err)
          else await done(`Published ${branch}`)
        },
      })
    }
    fail(r.error)
  }
  const pull = async () => {
    if (!repo) return
    busy("Pulling…")
    const err = await repo.pull((l) => busy(`Pulling… ${l}`))
    if (err) return fail(err)
    await done("Pulled")
  }
  const aiMessage = async () => {
    busy("Asking the AI for a commit message…")
    const r = await aiCommitMessage(ws)
    if (typeof r !== "string") return fail(r.error)
    setMsg(r)
    setFocus("message")
    setStatus({ text: "AI message ready: edit it, then Enter to commit", kind: "info" })
  }
  const revert = (r: Row | undefined) => {
    if (!r || !git) return
    setConfirm({
      text: `Discard all changes to ${r.entry.rel}${r.entry.untracked ? " (deletes the new file)" : ""}? (y/n)`,
      yes: async () => {
        const err = await git.revert(r.entry.path)
        if (err) fail(err)
        else await done(`Reverted ${r.entry.rel}`)
      },
    })
  }
  const open = (r: Row | undefined) => {
    if (!r) return
    const first = diff.find((d) => d.color === colors.gitAdd)?.line ?? 0
    void openAt(ws, r.entry.path, first, 0, 0)
  }

  const listH = Math.max(4, dims.height - 12)
  const viewH = Math.max(4, dims.height - 8)
  const maxTop = Math.max(0, diff.length - viewH)

  useKeyboard((key) => {
    if (ws.ui.get().modal?.kind !== "scm") return
    const stop = () => {
      key.preventDefault()
      key.stopPropagation()
    }
    // In the message box, plain typing must reach the input: only take the panel's own keys.
    const messageKey = focus === "message" && !confirm && !(key.name === "return" || key.name === "escape" || key.name === "tab")
    if (messageKey) return
    stop()
    if (confirm) {
      const c = confirm
      setConfirm(null)
      if (key.name === "y") void c.yes()
      return
    }
    if (key.name === "return" && key.meta) return void commit()
    if (key.name === "escape") {
      if (focus === "message") setFocus("list")
      else close()
      return
    }
    if (key.name === "tab") return setFocus((f) => (f === "list" ? "message" : "list"))
    if (focus === "message") {
      if (key.name === "return") void commit()
      return
    }
    switch (key.name) {
      case "down":
      case "j":
        setSel((s) => Math.min(rows.length - 1, s + 1))
        break
      case "up":
      case "k":
        setSel((s) => Math.max(0, s - 1))
        break
      case "space":
      case "s":
        void toggleStage(row)
        break
      case "a":
        void repo?.stageAll().then((e) => (e ? fail(e) : done("Staged all changes")))
        break
      case "r":
        revert(row)
        break
      case "return":
        open(row)
        break
      case "c":
        setFocus("message")
        break
      case "m":
        void aiMessage()
        break
      case "v":
        void sendChangesForReview(ws)
        break
      case "p":
        if (key.shift) void push()
        break
      case "u":
        if (key.shift) void pull()
        break
      case "b":
        ws.ui.set({ modal: { kind: "branches" } })
        break
      case "pagedown":
        setTop((t) => Math.min(maxTop, t + viewH - 2))
        break
      case "pageup":
        setTop((t) => Math.max(0, t - viewH + 2))
        break
    }
  })

  if (!git?.enabled || !repo) {
    return (
      <Modal title="Source control" height={5} onClose={close}>
        <text fg={colors.dim}>Not a git repository.</text>
      </Modal>
    )
  }

  const w = Math.min(dims.width - 4, 170)
  const leftW = Math.min(52, Math.max(30, Math.floor(w * 0.36)))
  const b = git.branch
  const header = b ? `⎇ ${b.name}${b.ahead ? ` ↑${b.ahead}` : ""}${b.behind ? ` ↓${b.behind}` : ""}` : ""
  const listTop = Math.max(0, Math.min(sel - listH + 1, rows.length - listH))
  const btn = (label: string, run: () => void, strong = false) => (
    <HoverBox onPress={run} paddingX={1} bg={strong ? colors.accentDim : colors.segmentBg}>
      <text selectable={false} fg={colors.text}>
        {label}
      </text>
    </HoverBox>
  )
  const sectionTitle = (s: Section) => (s === "conflict" ? `Merge conflicts (${counts.conflict})` : s === "staged" ? `Staged (${counts.staged})` : `Changes (${counts.changes})`)

  // Render rows with a heading before each section.
  const visibleRows = rows.slice(listTop, listTop + listH)
  const body: ReactNode[] = []
  let lastSection: Section | null = listTop > 0 ? rows[listTop - 1]!.section : null
  visibleRows.forEach((r, i) => {
    const idx = listTop + i
    if (r.section !== lastSection) {
      body.push(
        <box key={`h-${r.section}`} height={1}>
          <text selectable={false} fg={colors.headerFg}>
            {sectionTitle(r.section)}
          </text>
        </box>,
      )
      lastSection = r.section
    }
    const letter = LETTER(r.entry, r.section)
    body.push(
      <box
        key={`${r.section}:${r.entry.path}`}
        height={1}
        flexDirection="row"
        overflow="hidden"
        backgroundColor={idx === sel && focus === "list" ? colors.selectionBg : idx === sel ? colors.segmentBg : undefined}
        onMouseDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setFocus("list")
          if (idx === sel) open(r)
          else setSel(idx)
        }}
      >
        <box width={3} flexShrink={0}>
          <text selectable={false} fg={letterColor(letter)}>
            {" " + letter}
          </text>
        </box>
        <box flexGrow={1} overflow="hidden">
          <text selectable={false} wrapMode="none" truncate fg={idx === sel ? colors.text : colors.dim}>
            {r.entry.rel}
          </text>
        </box>
        <HoverBox onPress={() => void toggleStage(r)}>
          <text selectable={false} fg={colors.dim}>
            {r.section === "staged" ? " − " : " + "}
          </text>
        </HoverBox>
      </box>,
    )
  })

  return (
    <Modal title={`Source control  ${header}`} width={w} height={dims.height - 2} onClose={close}>
      <box flexDirection="row" flexGrow={1} gap={2}>
        <box width={leftW} flexShrink={0} flexDirection="column">
          <box height={1}>
            <text selectable={false} fg={colors.headerFg}>
              Message {focus === "message" ? "(Enter commits, Tab to files)" : "(c or Tab to write)"}
            </text>
          </box>
          <box border={["left"]} borderColor={focus === "message" ? colors.accent : colors.divider} height={1} onMouseDown={() => setFocus("message")}>
            <input
              key={inputKey}
              value={message}
              focused={focus === "message" && !confirm}
              placeholder="Commit message"
              backgroundColor={colors.bg}
              focusedBackgroundColor={colors.bg}
              textColor={colors.text}
              onInput={(v: string) => setMessage(v)}
            />
          </box>
          <box height={1} />
          <box flexDirection="row" flexWrap="wrap" gap={1}>
            {btn("Commit ⏎", () => void commit(), true)}
            {btn("Amend", () => void commit(true))}
            {btn("AI message (m)", () => void aiMessage())}
            {btn("AI review (v)", () => void sendChangesForReview(ws))}
            {btn(`Push${b?.ahead ? ` ↑${b.ahead}` : ""} (P)`, () => void push())}
            {btn(`Pull${b?.behind ? ` ↓${b.behind}` : ""} (U)`, () => void pull())}
            {btn("Branch (b)", () => ws.ui.set({ modal: { kind: "branches" } }))}
          </box>
          <box height={1} />
          {rows.length === 0 ? (
            <text selectable={false} fg={colors.dim}>
              No changes. Working tree clean.
            </text>
          ) : (
            body
          )}
        </box>
        <box flexGrow={1} flexDirection="column" overflow="hidden" onMouseScroll={(e) => {
          e.stopPropagation()
          setTop((t) => Math.max(0, Math.min(maxTop, t + (e.scroll?.direction === "up" ? -3 : 3))))
        }}>
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
          {confirm?.text ??
            status?.text ??
            "Space stage/unstage · a stage all · r revert · Enter open · Alt+Enter commit · P push · U pull · m AI message · v AI review · Esc close"}
        </text>
      </box>
    </Modal>
  )
}

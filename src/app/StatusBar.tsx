import { useSyncExternalStore } from "react"
import { useTerminalDimensions } from "@opentui/react"
import { useBuffers, useCursor, useUi, useWorkspace } from "./workspace"
import { ui as colors } from "../config/theme"
import { runCommand, type CommandId } from "../keymap/commands"
import { HoverBox } from "./Modal"
import { describeDiagnostic, diagnosticsAtCursor } from "../lsp/lspActions"
import { useMultiEditState } from "../editor/MultiEdit"
import { describeBlame, useLineBlame } from "../git/blame"
import { useGitActivity, useSpinner } from "../git/activity"
import { describeUsage, formatBytes, useResourceUsage } from "./resources"

const none = { subscribe: () => () => {}, getSnapshot: () => 0 }

const editorHints: [string, CommandId][] = [
  ["^P files", "file.picker"],
  ["^J ai", "focus.ai"],
  ["^L send to ai", "ai.sendContext"],
  ["F1 commands", "app.palette"],
]
const aiHints: [string, CommandId][] = [
  ["^E editor", "focus.editor"],
  ["^P files", "file.picker"],
  ["F1 commands", "app.palette"],
]

/** Status-bar glyphs: Nerd Font icons when the tree uses them, plain characters otherwise. */
export const STATUS_GLYPHS = {
  nerd: { branch: "", error: "", warning: "", ai: "", cpu: "" },
  plain: { branch: "⎇", error: "✖", warning: "⚠", ai: "●", cpu: "▤" },
}

const LANG: Record<string, string> = {
  typescript: "TypeScript",
  typescriptreact: "TypeScript JSX",
  javascript: "JavaScript",
  javascriptreact: "JavaScript JSX",
  markdown: "Markdown",
  json: "JSON",
  python: "Python",
  rust: "Rust",
  go: "Go",
  zig: "Zig",
}
const langName = (ft: string | undefined) => (ft ? (LANG[ft] ?? ft[0]!.toUpperCase() + ft.slice(1)) : "Plain text")

/** A coloured block (branch, AI). */
function Segment({ children, bg, onPress }: { children: string; bg: string; onPress?: () => void }) {
  return (
    <HoverBox onPress={onPress} bg={bg} hoverBg={colors.selectionBg} paddingX={1}>
      <text selectable={false} fg={colors.text}>
        {children}
      </text>
    </HoverBox>
  )
}

/**
 * Bottom bar, left to right: [branch] [problems] message-or-hints … [Ln/Col (selection)]
 * [language] [EOL] [language servers] [CPU / memory] [AI]. Hints are dropped whole when space is short.
 */
export function StatusBar({ aiStatus }: { aiStatus: string }) {
  const ws = useWorkspace()
  const ui = useUi()
  const buffers = useBuffers()
  useCursor() // Ln/Col and the line's blame follow the cursor
  const dims = useTerminalDimensions()
  useSyncExternalStore(ws.lsp?.subscribe ?? none.subscribe, ws.lsp?.getSnapshot ?? none.getSnapshot)
  useSyncExternalStore(ws.git?.subscribe ?? none.subscribe, ws.git?.getSnapshot ?? none.getSnapshot)
  useSyncExternalStore(ws.review?.store.subscribe ?? none.subscribe, () => ws.review?.store.get().version ?? 0)
  const multi = useMultiEditState()
  const blame = describeBlame(useLineBlame(ws))
  const buf = buffers.active
  const g = ws.config.tree.icons === "nerd" ? STATUS_GLYPHS.nerd : STATUS_GLYPHS.plain

  // copane plus the language servers, agents and terminals it started; click for each one's share.
  const usage = useResourceUsage(ui.resources ?? ws.config.statusBar.resources)
  const usageText = usage ? `${g.cpu} ${formatBytes(usage.total.rss)} ${Math.round(usage.total.cpu)}%` : ""

  // The open file's repository (as VS Code), named when the project holds several. With no file
  // in one, the project's own repository, or the only one in its folders (a project folder holding
  // one clone): never a nested one picked at random among several (~ with its projects).
  const only = ws.git?.list().length === 1 ? ws.git.list()[0]! : null
  const repo = ws.git ? (ws.git.for(buf?.path) ?? (ws.git.main.enabled ? ws.git.main : only)) : null
  const branch = repo?.branch
  const repoName = repo && ws.git!.list().length > 1 ? `${ws.git!.name(repo)} ` : ""
  // A push, pull or commit from Source control keeps running when the panel closes: show it here.
  const activity = useGitActivity()
  const working = activity?.kind === "busy"
  const spin = useSpinner(working)
  const progress = working ? ` ${spin} ${activity.text.length > 32 ? activity.text.slice(0, 31) + "…" : activity.text}` : ""
  // Several repositories and none of them the open file's: say so, and the click lists them.
  const several = !repo && (ws.git?.list().length ?? 0) > 1
  const changed = several ? ws.git!.changedCount() : 0
  const branchText = branch
    ? `${g.branch} ${repoName}${branch.name}${branch.ahead ? ` ↑${branch.ahead}` : ""}${branch.behind ? ` ↓${branch.behind}` : ""}${progress}`
    : several
      ? `${g.branch} ${ws.git!.list().length} repos${changed ? ` ● ${changed}` : ""}${progress}`
      : ""
  const lspStatus = ws.lsp?.status() ?? ""
  const counts = ws.lsp?.counts() ?? { errors: 0, warnings: 0 }
  // Files with AI edits not reviewed yet (Alt+N goes through them).
  const reviewCount = ws.review?.files().length ?? 0
  const reviewText = reviewCount ? `✦ ${reviewCount} to review` : ""
  const problemsText = lspStatus ? `${g.error} ${counts.errors} ${g.warning} ${counts.warnings}` : ""
  const ta = buf?.textarea
  // From the selection's offsets: copying the selected text just to count it is costly after select-all.
  const sel = ta?.hasSelection() ? ta.getSelection() : null
  const selected = sel ? Math.abs(sel.end - sel.start) : 0
  const text = buf?.kind === "text" ? buf : null
  const pos = text
    ? `${text.dirty ? "● " : ""}Ln ${text.cursor.row + 1}, Col ${text.cursor.col + 1}${selected ? ` (${selected} selected)` : ""}`
    : buf?.kind === "image" && buf.image
      ? `${buf.image.width}×${buf.image.height}`
      : ""
  const lang = text ? langName(text.filetype) : buf?.kind === "image" ? (buf.image?.format.toUpperCase() ?? "Image") : buf ? "Markdown preview" : ""
  const eol = text ? (text.eol === "\r\n" ? "CRLF" : "LF") : ""
  // A badge while the AI has news you haven't looked at (finished, or waiting for an answer).
  const badge = ui.aiAttention === "waiting" ? " ⚠ needs you" : ui.aiAttention === "finished" ? " ✓ done" : ""
  const aiText = aiStatus ? `${g.ai} ${aiStatus.replace(/ ●$/, "")}${badge}` : ""

  const noticeColor = ui.notice?.kind === "error" ? colors.error : ui.notice?.kind === "warn" ? colors.warn : colors.ok
  // A problem on the cursor's line replaces the hints (like VS Code's status message).
  const here = ui.focus === "editor" && !ui.notice ? diagnosticsAtCursor(ws)[0] : undefined

  // Room for hints: everything else is measured as rendered (text + padding + gaps).
  const seg = (t: string, pad = 2) => (t ? Bun.stringWidth(t) + pad + 2 : 0)
  let room =
    dims.width -
    2 -
    seg(branchText) -
    seg(problemsText, 0) -
    seg(reviewText, 0) -
    seg(pos, 0) -
    seg(lang, 0) -
    seg(eol, 0) -
    seg(lspStatus, 0) -
    seg(usageText, 0) -
    seg(aiText) -
    (ui.updateReady ? 30 : ui.updateAvailable ? 26 : 0)
  const hints: [string, CommandId][] = []
  for (const h of ui.focus === "ai" ? aiHints : editorHints) {
    const w = Bun.stringWidth(h[0]) + 2
    if (w > room) break
    hints.push(h)
    room -= w
  }

  return (
    <box flexDirection="row" height={1} flexShrink={0} backgroundColor={colors.statusBg} paddingRight={1} gap={2}>
      <box flexDirection="row" flexShrink={0} gap={1}>
        {branchText ? <Segment bg={colors.segmentBg} onPress={() => void runCommand(ws, several ? "git.pickRepo" : "git.changes")}>{branchText}</Segment> : null}
        {problemsText ? (
          <HoverBox onPress={() => void runCommand(ws, "lsp.problems")}>
            <text selectable={false} fg={counts.errors ? colors.error : counts.warnings ? colors.warn : colors.dim}>
              {problemsText}
            </text>
          </HoverBox>
        ) : null}
        {reviewText ? (
          <HoverBox onPress={() => void runCommand(ws, "ai.nextChange")}>
            <text selectable={false} fg={colors.aiEdit}>
              {reviewText}
            </text>
          </HoverBox>
        ) : null}
      </box>
      <box flexGrow={1} flexDirection="row" overflow="hidden" gap={2}>
        {ui.updateReady ? (
          <HoverBox onPress={() => void runCommand(ws, "app.restart")} bg={colors.accent} paddingX={1}>
            <text selectable={false} fg={colors.statusBg}>
              ⟳ Update installed: restart
            </text>
          </HoverBox>
        ) : ui.updateAvailable ? (
          <HoverBox onPress={() => void runCommand(ws, "app.installUpdate")} bg={colors.segmentBg} paddingX={1}>
            <text selectable={false} fg={colors.accent}>
              ⬆ copane {ui.updateAvailable}: install
            </text>
          </HoverBox>
        ) : null}
        {multi && multi.occs.length > 1 && !ui.notice ? (
          <text selectable={false} fg={colors.warn}>
            {multi.occs.length} cursors: type to edit all · Ctrl+D adds next · Esc ends
          </text>
        ) : here ? (
          <HoverBox onPress={() => void runCommand(ws, "lsp.hover")}>
            <text selectable={false} fg={(here.severity ?? 1) === 1 ? colors.error : colors.warn}>
              {describeDiagnostic(here).split("\n")[0]}
            </text>
          </HoverBox>
        ) : !ui.notice && blame && ui.focus === "editor" ? (
          <HoverBox onPress={() => void runCommand(ws, "git.blameLine")}>
            <text selectable={false} fg={colors.headerFg}>
              {blame}
            </text>
          </HoverBox>
        ) : ui.notice ? (
          <HoverBox onPress={() => ws.ui.set({ notice: null })}>
            <text selectable={false} fg={noticeColor}>
              {ui.notice.text}
            </text>
          </HoverBox>
        ) : (
          hints.map(([label, id]) => (
            <HoverBox key={id} onPress={() => void runCommand(ws, id)}>
              <text selectable={false} fg={colors.dim}>
                {label}
              </text>
            </HoverBox>
          ))
        )}
      </box>
      <box flexDirection="row" gap={2} flexShrink={0}>
        {pos ? (
          <HoverBox onPress={() => void runCommand(ws, "edit.gotoLine")}>
            <text selectable={false} fg={colors.text}>
              {pos}
            </text>
          </HoverBox>
        ) : null}
        {lang ? (
          <text selectable={false} fg={colors.headerFg}>
            {lang}
          </text>
        ) : null}
        {eol ? (
          <text selectable={false} fg={colors.headerFg}>
            {eol}
          </text>
        ) : null}
        {lspStatus ? (
          <text selectable={false} fg={lspStatus.includes("✗") ? colors.error : colors.headerFg}>
            {lspStatus}
          </text>
        ) : null}
        {usage ? (
          <HoverBox
            onPress={() => ws.ui.set({ modal: { kind: "info", x: dims.width - 40, y: dims.height - 1, text: describeUsage(usage) } })}
          >
            <text selectable={false} fg={colors.headerFg}>
              {usageText}
            </text>
          </HoverBox>
        ) : null}
      </box>
      {aiText ? (
        <Segment bg={ui.focus === "ai" || ui.aiAttention ? colors.accentDim : colors.segmentBg} onPress={() => void runCommand(ws, ui.focus === "ai" ? "focus.editor" : "focus.ai")}>
          {aiText}
        </Segment>
      ) : null}
    </box>
  )
}

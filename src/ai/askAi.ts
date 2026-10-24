/**
 * "Ask the AI" actions that hand it a ready-made prompt: fix these problems, review these changes.
 * Like Ctrl+L, they type into the AI's prompt and leave submitting to you.
 */
import { relative, sep } from "node:path"
import type { Workspace } from "../app/workspace"
import { formatChangesForAgent, formatProblemsForAgent, type Problem } from "./sendToAgent"

/** Close any dialog and move to the AI pane, showing it if hidden. */
function showAi(ws: Workspace): void {
  ws.ui.set({ modal: null, focus: "ai", aiVisible: true })
  ws.ai?.focus()
}

/**
 * Errors and warnings to the AI with "fix these": the ones on `at` (a file and line), else the
 * current file's, else (or with `all`) every open file's. Typed into the prompt without
 * submitting, like Ctrl+L.
 */
export function sendProblems(ws: Workspace, opts: { at?: { path: string; line: number }; all?: boolean } = {}): void {
  const { at, all } = opts
  const ai = ws.ai
  if (!ai) return ws.notify("AI terminal is not running", "warn")
  if (!ws.lsp) return ws.notify("No language server running", "warn")
  const serious = (severity?: number) => (severity ?? 1) <= 2
  const toProblem = (
    path: string,
    d: { range: { start: { line: number } }; severity?: number; message: string; source?: string; code?: string | number },
  ): Problem => ({
    relPath: relative(ws.root, path),
    line: d.range.start.line + 1,
    severity: d.severity ?? 1,
    message: d.message,
    source: d.source,
    code: d.code,
  })
  const active = ws.buffers.active
  let problems: Problem[] = []
  if (at)
    problems = ws.lsp
      .diagnostics(at.path)
      .filter((d) => serious(d.severity) && d.range.start.line <= at.line && d.range.end.line >= at.line)
      .map((d) => toProblem(at.path, d))
  else if (active?.kind === "text" && !all)
    problems = ws.lsp
      .diagnostics(active.path)
      .filter((d) => serious(d.severity))
      .map((d) => toProblem(active.path, d))
  if (!problems.length && !at)
    problems = ws.lsp
      .allDiagnostics()
      .filter((p) => serious(p.diag.severity))
      .map((p) => toProblem(p.path, p.diag))
  if (!problems.length) return ws.notify(at ? "No error or warning on this line" : "No errors or warnings in open files")
  problems.sort((a, b) => a.severity - b.severity || a.relPath.localeCompare(b.relPath) || a.line - b.line)
  ai.type(`Fix ${problems.length === 1 ? "this problem" : "these problems"}, keeping the changes minimal: `)
  ai.paste(formatProblemsForAgent(problems))
  showAi(ws)
}

/** The git changes to the AI with "review these" (staged ones if any, else everything uncommitted). */
export async function sendChangesForReview(ws: Workspace): Promise<void> {
  const ai = ws.ai
  if (!ai) return ws.notify("AI terminal is not running", "warn")
  const git = ws.git
  const repos = git?.list() ?? []
  if (!git || !repos.length) return ws.notify("Not a git repository", "warn")
  // Several repositories (see git/repos.ts): each one's changes, under its folder's name.
  const parts = await Promise.all(
    repos.map(async (s) => {
      const changes = await s.repo!.changesForReview()
      const dir = relative(ws.root, s.repo!.top).split(sep).join("/")
      // New files are named from the project, where the AI runs.
      if (dir && !dir.startsWith("..")) changes.untracked = changes.untracked.map((p) => `${dir}/${p}`)
      const text = formatChangesForAgent(changes)
      return text && repos.length > 1
        ? `In the repository ${git.name(s)} (its diff paths are relative to ${dir || "."}):\n${text}`
        : text
    }),
  )
  const text = parts.filter(Boolean).join("\n\n")
  if (!text) return ws.notify("No changes to review")
  ai.type("Review these changes for bugs, risky edits and missing tests. Don't change anything yet: ")
  ai.paste(text)
  showAi(ws)
}

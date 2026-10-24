/**
 * "Report a problem": the AI in the side pane drafts a GitHub issue for copane. copane gathers the
 * facts a good report needs (version, platform, terminal, the end of the error log) with private
 * paths shortened, and types a prompt that tells the agent to search for duplicates, show the draft
 * and only post after an explicit yes. Like the other "ask the AI" actions, nothing is submitted:
 * the user adds what happened and presses Enter.
 */
import { homedir } from "node:os"
import { isWsl } from "../app/clipboard"
import { errorLogPath } from "../app/shutdown"
import { isCompiled } from "../app/update"
import type { Workspace } from "../app/workspace"
import pkg from "../../package.json"

export const ISSUE_REPO = "sevheng/copane"
const LOG_LINES = 40

/** Paths that say who and where you are become ~ and <project>. */
export function shortenPaths(text: string, root: string, home = homedir()): string {
  const swap = (s: string, from: string, to: string) => (from && from !== "/" ? s.split(from).join(to) : s)
  return swap(swap(text, root, "<project>"), home, "~")
}

/** The facts for the report, as plain lines. */
export async function reportContext(
  ws: Workspace,
  opts: { env?: Record<string, string | undefined>; logPath?: string; home?: string } = {},
): Promise<string> {
  const env = opts.env ?? Bun.env
  const terminal = env.TERM_PROGRAM ?? (env.WT_SESSION ? "Windows Terminal" : undefined) ?? "unknown"
  const lines = [
    `copane ${pkg.version} (${isCompiled() ? "installed binary" : "from source"})`,
    `OS: ${process.platform} ${process.arch}${isWsl() ? " (WSL)" : ""}`,
    `Terminal: ${terminal}, TERM=${env.TERM ?? "?"}`,
    `AI command: ${ws.config.ai.command}`,
  ]
  const log = await Bun.file(opts.logPath ?? errorLogPath())
    .text()
    .catch(() => "")
  // Entries start with an ISO timestamp; stack lines follow. The last ones are what matters.
  const tail = log.trimEnd().split("\n").slice(-LOG_LINES).join("\n")
  lines.push(tail ? `Last lines of ~/.local/state/copane/errors.log:\n${tail}` : "No internal errors logged.")
  return shortenPaths(lines.join("\n"), ws.root, opts.home)
}

/** The instructions for the agent, around the facts. */
export function reportPrompt(context: string): string {
  return [
    `I want to report a problem with copane (the editor this pane runs in) at https://github.com/${ISSUE_REPO}. Please:`,
    "1. If I haven't said what went wrong and how to make it happen, ask me first.",
    `2. Search existing issues (gh issue list --repo ${ISSUE_REPO} --state all --search "<keywords>"). If one matches, show it and offer to add a comment there instead of opening a new issue.`,
    "3. Write a short issue: a title, what happened, steps to reproduce, what I expected, and the facts below.",
    `4. Show me the whole draft and wait for my explicit yes before running gh issue create --repo ${ISSUE_REPO} --title "..." --body-file <file>. Never post without that yes.`,
    `5. If gh is missing or not logged in, give me a https://github.com/${ISSUE_REPO}/issues/new?title=...&body=... link (URL-encoded) to open instead.`,
    "6. Don't include file contents, secrets or anything else private; paths are already shortened.",
    "",
    "Facts:",
    context,
    "",
    "What went wrong: ",
  ].join("\n")
}

/** F1 › Report a problem: type the prompt into the AI pane (not submitted) and go there. */
export async function reportProblem(ws: Workspace): Promise<void> {
  const ai = ws.ai
  if (!ai) return ws.notify("AI terminal is not running: report at https://github.com/" + ISSUE_REPO + "/issues", "warn")
  ai.paste(reportPrompt(await reportContext(ws)))
  ws.ui.set({ modal: null, focus: "ai", aiVisible: true })
  ai.focus()
  ws.notify("Add what went wrong, then Enter: the AI drafts the issue and asks before posting")
}

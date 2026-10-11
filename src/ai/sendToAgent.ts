export interface AgentContext {
  /** Typed as keystrokes so the CLI shows it as a file mention, e.g. "@src/a.ts#L3-5 ". */
  reference: string
  /** Selected code, sent as a bracketed paste so newlines don't submit. Null without a selection. */
  snippet: string | null
}

/**
 * What Ctrl+L sends to the AI CLI for the current file or selection.
 * Claude Code resolves "@path" (and "@path#Lx-y") as a file mention.
 */
export function formatContextForAgent(
  relPath: string,
  selection: { start: number; end: number; text: string } | null,
): AgentContext {
  const path = relPath.includes(" ") ? `"${relPath}"` : relPath
  if (!selection || selection.text.length === 0) return { reference: `@${path} `, snippet: null }
  const lines = selection.start === selection.end ? `L${selection.start}` : `L${selection.start}-${selection.end}`
  const fence = selection.text.includes("```") ? "````" : "```"
  // No trailing newline: the user decides when to submit.
  return {
    reference: `@${path}#${lines} `,
    snippet: `${fence}\n${selection.text.replace(/\n$/, "")}\n${fence} `,
  }
}

/** Wrap text as a bracketed paste so multi-line input is not submitted line by line. */
export function bracketedPaste(text: string): string {
  return `\x1b[200~${text}\x1b[201~`
}

export interface Problem {
  relPath: string
  /** 1-based. */
  line: number
  /** 1 error, 2 warning. */
  severity: number
  message: string
  source?: string
  code?: string | number
}

const mention = (relPath: string) => (relPath.includes(" ") ? `"${relPath}"` : relPath)

/** Errors and warnings as lines the AI can act on: "@src/a.ts#L12 error: message (ts 2345)". */
export function formatProblemsForAgent(problems: Problem[], limit = 40): string {
  const lines = problems.slice(0, limit).map((p) => {
    const kind = p.severity === 1 ? "error" : "warning"
    const code = p.code !== undefined ? ` (${[p.source, p.code].filter((x) => x !== undefined && x !== "").join(" ")})` : ""
    return `@${mention(p.relPath)}#L${p.line} ${kind}: ${p.message.split("\n")[0]}${code}`
  })
  if (problems.length > limit) lines.push(`…and ${problems.length - limit} more.`)
  return lines.join("\n")
}

/**
 * Changes for the AI to review: the diff itself while it is small enough to paste, otherwise the
 * list of changed files (the AI can run `git diff` itself). New files are listed by name.
 */
export function formatChangesForAgent(changes: { diff: string; stat: string; staged: boolean; untracked: string[] }, maxBytes = 40_000): string {
  const parts: string[] = []
  const which = changes.staged ? "staged changes" : "uncommitted changes"
  if (changes.diff.trim()) {
    if (changes.diff.length <= maxBytes) {
      const fence = changes.diff.includes("```") ? "````" : "```"
      parts.push(`The ${which}:\n${fence}diff\n${changes.diff.replace(/\n$/, "")}\n${fence}`)
    } else {
      parts.push(`The ${which} are too big to paste (${Math.round(changes.diff.length / 1024)} KB); see \`git diff${changes.staged ? " --cached" : " HEAD"}\`. Changed files:\n${changes.stat.trim()}`)
    }
  }
  if (changes.untracked.length) parts.push(`New files: ${changes.untracked.map((p) => `@${mention(p)}`).join(" ")}`)
  return parts.join("\n\n")
}

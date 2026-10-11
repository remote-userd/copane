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

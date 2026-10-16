import { homedir } from "node:os"
import { basename, join } from "node:path"

/**
 * Claude Code conversations by id. Each claude tab starts with its own `--session-id`, so a
 * restart of copane resumes each tab's conversation (`--continue` would give every tab in a
 * folder the same, latest one).
 */

/** Args that already pick a conversation: the tab leaves the choice to them. */
const PICKS = new Set(["--session-id", "--resume", "-r", "--continue", "-c"])

/** A new conversation id for a tab running `claude`, unless its args pick one themselves. */
export function newClaudeSession(command: string, args: string[]): string | undefined {
  if (basename(command) !== "claude") return undefined
  if (args.some((a) => PICKS.has(a) || a.startsWith("--resume=") || a.startsWith("--session-id="))) return undefined
  return crypto.randomUUID()
}

const claudeHome = () => Bun.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude")

/** Whether Claude saved conversation `id` (from its first message): `projects/<folder>/<id>.jsonl`. */
export async function conversationSaved(id: string, home = claudeHome()): Promise<boolean> {
  try {
    for await (const _ of new Bun.Glob(`projects/*/${id}.jsonl`).scan({ cwd: home, onlyFiles: true })) return true
  } catch {
    // no ~/.claude yet
  }
  return false
}

/** The args to start a tab's claude with: back into its conversation, or a new one under that id. */
export async function claudeArgs(args: string[], id: string, home?: string): Promise<string[]> {
  return (await conversationSaved(id, home)) ? [...args, "--resume", id] : [...args, "--session-id", id]
}

import { isAbsolute, resolve } from "node:path"
import { openAt } from "../app/navHistory"
import type { Workspace } from "../app/workspace"
import { revealPlatform } from "../files/reveal"

/** Something clickable in a terminal line: a file position or a web address. */
export type TerminalLink = { kind: "file"; path: string; line: number; col: number } | { kind: "url"; url: string }

const URL = /https?:\/\/[^\s"'<>`)\]]+/g
/** `path:line[:col]` (also `path(line,col)` as tsc prints without --pretty). */
const FILE = /((?:\/|\.{1,2}\/|~\/|[\w@-][\w.@-]*\/)?[\w./@~-]*\.[A-Za-z]\w{0,5})(?::(\d+)(?::(\d+))?|\((\d+),(\d+)\))/g

/** The link under column `col` of a terminal line, if any. Relative paths are taken from `cwd`. */
export function linkAt(line: string, col: number, cwd: string): TerminalLink | null {
  for (const m of line.matchAll(URL)) {
    if (col < m.index || col >= m.index + m[0].length) continue
    return { kind: "url", url: m[0].replace(/[.,;:]+$/, "") }
  }
  for (const m of line.matchAll(FILE)) {
    if (col < m.index || col >= m.index + m[0].length) continue
    const file = m[1]!.replace(/^file:\/\//, "")
    const path = file.startsWith("~/")
      ? resolve(Bun.env.HOME ?? "/", file.slice(2))
      : isAbsolute(file)
        ? file
        : resolve(cwd, file)
    return { kind: "file", path, line: Number(m[2] ?? m[4]), col: Number(m[3] ?? m[5] ?? 1) }
  }
  return null
}

/** The command that opens a web address in the system browser. */
export function browserCommand(url: string, platform = revealPlatform()): string[] {
  if (platform === "wsl") return Bun.which("wslview") ? ["wslview", url] : ["explorer.exe", url]
  if (platform === "mac") return ["open", url]
  return ["xdg-open", url]
}

/** Open a file at its line in the editor, or a web address in the browser. */
export async function openLink(ws: Workspace, link: TerminalLink): Promise<void> {
  if (link.kind === "file") {
    if (!(await Bun.file(link.path).exists())) return ws.notify(`No such file: ${link.path}`, "warn")
    const col = Math.max(0, link.col - 1)
    await openAt(ws, link.path, Math.max(0, link.line - 1), col, col)
    ws.ui.set({ focus: "editor" })
    return
  }
  try {
    Bun.spawn(browserCommand(link.url), { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).unref()
    ws.notify(`Opening ${link.url}`)
  } catch {
    ws.notify(`Could not open ${link.url}`, "warn")
  }
}

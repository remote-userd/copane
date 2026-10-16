import { resolve } from "node:path"

/**
 * What to open from the command line: a folder (the project), a file (the project is the
 * current folder), or nothing (root null: the welcome page picks a folder).
 */
export async function pathArg(argv: string[], cwd = process.cwd()): Promise<{ root: string | null; file: string | null }> {
  const arg = argv.find((a) => !a.startsWith("-"))
  if (!arg) return { root: null, file: null }
  const abs = resolve(cwd, arg)
  // A missing path is a new file, opened relative to the current folder.
  const info = await Bun.file(abs)
    .stat()
    .catch(() => null)
  if (info?.isDirectory()) return { root: abs, file: null }
  return { root: cwd, file: abs }
}

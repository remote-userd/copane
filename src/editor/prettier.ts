import { dirname, join, relative } from "node:path"

/**
 * Format with the project's Prettier, as VS Code does with the Prettier extension. Used when
 * the project has Prettier in node_modules, or a Prettier config and Prettier on PATH.
 */

const CONFIGS = [
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.yaml",
  ".prettierrc.yml",
  ".prettierrc.json5",
  ".prettierrc.js",
  ".prettierrc.cjs",
  ".prettierrc.mjs",
  ".prettierrc.toml",
  "prettier.config.js",
  "prettier.config.cjs",
  "prettier.config.mjs",
]

/** Extensions Prettier formats without plugins. */
const EXTENSIONS = new Set([
  "js",
  "jsx",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "mts",
  "cts",
  "json",
  "jsonc",
  "json5",
  "css",
  "scss",
  "less",
  "html",
  "vue",
  "md",
  "markdown",
  "mdx",
  "yaml",
  "yml",
  "graphql",
  "gql",
  "hbs",
  "handlebars",
])

export function prettierHandles(path: string): boolean {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase()
  return EXTENSIONS.has(ext)
}

/** Folders from the file's up to the project root (inclusive). */
export function foldersUp(path: string, root: string): string[] {
  const out: string[] = []
  let dir = dirname(path)
  while (true) {
    out.push(dir)
    if (dir === root || relative(root, dir).startsWith("..")) break
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return out
}

export async function hasPrettierConfig(dir: string): Promise<boolean> {
  for (const name of CONFIGS) if (await Bun.file(join(dir, name)).exists()) return true
  const pkg = Bun.file(join(dir, "package.json"))
  if (!(await pkg.exists())) return false
  try {
    return (await pkg.json()).prettier !== undefined
  } catch {
    return false
  }
}

/** The Prettier binary to use for `path`, or null when the project doesn't use Prettier. */
export async function findPrettier(path: string, root: string): Promise<string | null> {
  const dirs = foldersUp(path, root)
  for (const dir of dirs) {
    const bin = join(dir, "node_modules", ".bin", "prettier")
    if (await Bun.file(bin).exists()) return bin
  }
  const global = Bun.which("prettier")
  if (!global) return null
  for (const dir of dirs) if (await hasPrettierConfig(dir)) return global
  return null
}

/** Run Prettier on `text` as if it were `path`. Throws with Prettier's message on a syntax error. */
export async function runPrettier(bin: string, path: string, text: string, cwd: string): Promise<string> {
  const p = Bun.spawn([bin, "--stdin-filepath", path], {
    cwd,
    stdin: new TextEncoder().encode(text),
    stdout: "pipe",
    stderr: "pipe",
    // A Prettier that hangs (a plugin waiting on something) would block format-on-save forever.
    timeout: 20_000,
  })
  const [out, err, code] = await Promise.all([Bun.readableStreamToText(p.stdout), Bun.readableStreamToText(p.stderr), p.exited])
  if (p.signalCode) throw new Error("prettier took too long and was stopped")
  if (code !== 0) throw new Error(err.trim().split("\n")[0] || `prettier exited with ${code}`)
  return out
}

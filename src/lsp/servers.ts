import { join } from "node:path"

/** A language server command for one or more filetypes. */
export interface ServerSpec {
  /** Stable key: one process per key per workspace. */
  key: string
  command: string[]
  /** LSP languageId for each filetype this server handles. */
  languages: Record<string, string>
}

export type LspOverrides = Record<string, { command: string[] } | false>

const TS_LANGS = { typescript: "typescript", typescriptreact: "typescriptreact", javascript: "javascript", javascriptreact: "javascriptreact" }

/** TypeScript 7+ ships a language server in `tsc --lsp`; prefer the project's own copy. */
async function workspaceTsc(root: string): Promise<string | null> {
  const bin = join(root, "node_modules", ".bin", "tsc")
  try {
    const pkg = (await Bun.file(join(root, "node_modules", "typescript", "package.json")).json()) as { version?: string }
    return Number(pkg.version?.split(".")[0]) >= 7 && (await Bun.file(bin).exists()) ? bin : null
  } catch {
    return null
  }
}

// PATH lookups are slow (on WSL, PATH includes the Windows folders under /mnt/c): once each.
const whichCache = new Map<string, string | null>()
const which = (cmd: string) => {
  if (!whichCache.has(cmd)) whichCache.set(cmd, Bun.which(cmd))
  return whichCache.get(cmd)!
}

/** Candidate servers per language, in order of preference; the first one installed wins. */
function candidates(filetype: string, root: string): (() => Promise<ServerSpec | null>)[] {
  const has = (cmd: string, spec: Omit<ServerSpec, "command">, args: string[] = []) => async () =>
    which(cmd) ? { ...spec, command: [cmd, ...args] } : null
  if (filetype in TS_LANGS)
    return [
      async () => {
        const tsc = await workspaceTsc(root)
        return tsc ? { key: "typescript", command: [tsc, "--lsp", "--stdio"], languages: TS_LANGS } : null
      },
      has("typescript-language-server", { key: "typescript", languages: TS_LANGS }, ["--stdio"]),
    ]
  if (filetype === "rust") return [has("rust-analyzer", { key: "rust", languages: { rust: "rust" } })]
  if (filetype === "go") return [has("gopls", { key: "go", languages: { go: "go" } })]
  if (filetype === "python")
    return [has("pyright-langserver", { key: "python", languages: { python: "python" } }, ["--stdio"]), has("pylsp", { key: "python", languages: { python: "python" } })]
  if (filetype === "zig") return [has("zls", { key: "zig", languages: { zig: "zig" } })]
  if (filetype === "c" || filetype === "cpp") return [has("clangd", { key: "c", languages: { c: "c", cpp: "cpp" } })]
  return []
}

const lookupCache = new Map<string, Promise<ServerSpec | null>>()

export async function serverFor(filetype: string | undefined, root: string, overrides: LspOverrides = {}): Promise<ServerSpec | null> {
  if (!filetype) return null
  const o = overrides[filetype]
  if (o === false) return null
  if (o) return { key: `custom:${filetype}`, command: o.command, languages: { [filetype]: filetype } }
  // Looked up once per language and workspace: PATH searches are slow on WSL.
  const key = `${root}\0${filetype}`
  let found = lookupCache.get(key)
  if (!found) {
    found = (async () => {
      for (const c of candidates(filetype, root)) {
        const spec = await c()
        if (spec) return spec
      }
      return null
    })()
    lookupCache.set(key, found)
  }
  return found
}

import { realpathSync } from "node:fs"
import { dirname, join } from "node:path"
import { projectRoot } from "./projectRoot"

/** A language server command for one or more filetypes. */
export interface ServerSpec {
  /** Stable key: one process per key per workspace. */
  key: string
  command: string[]
  /** LSP languageId for each filetype this server handles. */
  languages: Record<string, string>
  /** The folder it runs in (a package in a monorepo); the workspace when not set. */
  root?: string
  /** Sent with `initialize`. */
  initializationOptions?: unknown
}

export type LspOverrides = Record<string, { command: string[] } | false>

const TS_LANGS = { typescript: "typescript", typescriptreact: "typescriptreact", javascript: "javascript", javascriptreact: "javascriptreact" }

/** TypeScript 7+ ships a language server in `tsc --lsp`; prefer the package's own copy. */
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

/**
 * `typescript-language-server` with the package's own TypeScript (so each package type-checks
 * with its version), and Vue's TypeScript plugin when Vue's language server is installed: then
 * the same server also understands the script blocks of `.vue` files.
 */
async function tsLanguageServer(root: string): Promise<ServerSpec | null> {
  const cmd = which("typescript-language-server")
  if (!cmd) return null
  const tsserver = await findTsserver(root, cmd)
  const vuePlugin = await vueTypescriptPlugin()
  return {
    key: "typescript",
    command: [cmd, "--stdio"],
    languages: vuePlugin ? { ...TS_LANGS, vue: "vue" } : TS_LANGS,
    initializationOptions: {
      ...(tsserver ? { tsserver: { path: tsserver } } : {}),
      ...(vuePlugin ? { plugins: [{ name: "@vue/typescript-plugin", location: vuePlugin, languages: ["vue"] }] } : {}),
    },
  }
}

/**
 * The TypeScript to run: the package's own, else the one installed with the language server
 * (`npm i -g typescript-language-server typescript`). A package without TypeScript (a Nuxt app
 * often has none) would otherwise fail to start the server at all.
 */
async function findTsserver(root: string, serverBin: string): Promise<string | null> {
  const lib = (nodeModules: string) => join(nodeModules, "typescript", "lib", "tsserver.js")
  const dirs = [join(root, "node_modules")]
  try {
    // …/node_modules/typescript-language-server/lib/cli.mjs → …/node_modules
    dirs.push(dirname(dirname(dirname(realpathSync(serverBin)))))
  } catch {}
  for (const d of dirs) if (await Bun.file(lib(d)).exists()) return lib(d)
  return null
}

/** The major version of the TypeScript a `tsc` belongs to (0 when unknown). */
async function tsMajor(tsc: string): Promise<number> {
  try {
    // …/node_modules/typescript/bin/tsc
    const pkg = (await Bun.file(join(dirname(dirname(realpathSync(tsc))), "package.json")).json()) as { name?: string; version?: string }
    return pkg.name === "typescript" ? Number(pkg.version?.split(".")[0]) || 0 : 0
  } catch {
    return 0
  }
}

/** Where `@vue/typescript-plugin` is: inside the installed `@vue/language-server`, or beside it. */
let vuePlugin: Promise<string | null> | null = null
function vueTypescriptPlugin(): Promise<string | null> {
  vuePlugin ??= (async () => {
    const bin = which("vue-language-server")
    if (!bin) return null
    try {
      // …/lib/node_modules/@vue/language-server/bin/vue-language-server.js
      const pkg = dirname(dirname(realpathSync(bin)))
      for (const dir of [join(pkg, "node_modules"), dirname(dirname(pkg))])
        if (await Bun.file(join(dir, "@vue", "typescript-plugin", "package.json")).exists()) return dir
    } catch {}
    return null
  })()
  return vuePlugin
}

/** What to install when a language has no server: shown once, so a missing server is not silent. */
export function installHint(filetype: string): string | null {
  // TypeScript 7 alone has a server (`tsc --lsp`); Vue needs TypeScript 6's tsserver for its plugin.
  if (filetype in TS_LANGS) return "npm i -g typescript"
  if (filetype === "vue") return "npm i -g typescript-language-server typescript@6 @vue/language-server"
  if (filetype === "python") return "npm i -g pyright"
  if (filetype === "go") return "go install golang.org/x/tools/gopls@latest"
  if (filetype === "rust") return "rustup component add rust-analyzer"
  return null
}

/** The server family a filetype belongs to (which project markers find its root). */
function familyOf(filetype: string): string {
  if (filetype in TS_LANGS || filetype === "vue") return "typescript"
  return filetype === "cpp" ? "c" : filetype
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
      () => tsLanguageServer(root),
      // A global TypeScript 7 (`npm i -g typescript`).
      async () => {
        const tsc = which("tsc")
        return tsc && (await tsMajor(tsc)) >= 7 ? { key: "typescript", command: [tsc, "--lsp", "--stdio"], languages: TS_LANGS } : null
      },
    ]
  // .vue goes to the TypeScript server with Vue's plugin (TS7's tsc has no plugins).
  if (filetype === "vue")
    return [
      async () => {
        const spec = await tsLanguageServer(root)
        return spec?.languages.vue ? spec : null
      },
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

/**
 * The server for a file: run in the file's project (its package in a monorepo, see projectRoot),
 * or in the workspace `root` when the file is not given or has none of its own.
 */
export async function serverFor(filetype: string | undefined, root: string, overrides: LspOverrides = {}, file?: string): Promise<ServerSpec | null> {
  if (!filetype) return null
  const o = overrides[filetype]
  if (o === false) return null
  if (o) return { key: `custom:${filetype}`, command: o.command, languages: { [filetype]: filetype } }
  const dir = file ? await projectRoot(familyOf(filetype), file, root) : root
  // Looked up once per language and project: PATH searches are slow on WSL.
  const key = `${dir}\0${filetype}`
  let found = lookupCache.get(key)
  if (!found) {
    found = (async () => {
      for (const c of candidates(filetype, dir)) {
        const spec = await c()
        if (spec) return { ...spec, root: dir }
      }
      return null
    })()
    lookupCache.set(key, found)
  }
  return found
}

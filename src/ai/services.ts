import { basename, isAbsolute, join, relative, resolve } from "node:path"
import { IgnoreMatcher } from "../files/ignore"
import { listDir } from "../files/walk"

/**
 * Dev servers to run (`npm run dev` per package, `docker compose up`), each in a terminal tab of
 * the AI pane, and reading errors out of terminal output so they can reach the editor and the AI.
 */
export interface Service {
  name: string
  /** Run through the shell, in `cwd`. */
  command: string
  /** Absolute. */
  cwd: string
}

/** Scripts that start a dev server, in order of preference. */
const DEV_SCRIPTS = ["dev", "start:dev", "serve", "watch"]
/** Package folders this deep below the root are looked at (apps/web, packages/api, services/x/api). */
const MAX_DEPTH = 3

/** The package manager a folder uses, from its lockfile (or the root's). */
async function runner(dir: string, root: string): Promise<string> {
  for (const d of dir === root ? [dir] : [dir, root]) {
    if ((await Bun.file(join(d, "bun.lock")).exists()) || (await Bun.file(join(d, "bun.lockb")).exists())) return "bun run"
    if (await Bun.file(join(d, "pnpm-lock.yaml")).exists()) return "pnpm run"
    if (await Bun.file(join(d, "yarn.lock")).exists()) return "yarn"
  }
  return "npm run"
}

/** A package's dev service: its first dev-like script. */
async function packageService(dir: string, root: string): Promise<Service | null> {
  let pkg: { name?: string; scripts?: Record<string, string> }
  try {
    pkg = (await Bun.file(join(dir, "package.json")).json()) as typeof pkg
  } catch {
    return null
  }
  const script = DEV_SCRIPTS.find((s) => typeof pkg.scripts?.[s] === "string")
  if (!script) return null
  return { name: dir === root ? basename(root) : basename(dir), command: `${await runner(dir, root)} ${script}`, cwd: dir }
}

/**
 * Services found in a project: `docker compose up` when there's a compose file at the root, then
 * each package's dev script (the root's first), down to a few folders deep, skipping ignored
 * folders and node_modules.
 */
export async function detectServices(root: string): Promise<Service[]> {
  const out: Service[] = []
  for (const f of ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"])
    if (await Bun.file(join(root, f)).exists()) {
      out.push({ name: "docker", command: "docker compose up", cwd: root })
      break
    }
  const matcher = new IgnoreMatcher(root)
  const visit = async (dir: string, depth: number): Promise<void> => {
    const s = await packageService(dir, root)
    if (s) out.push(s)
    if (depth >= MAX_DEPTH) return
    for (const e of await listDir(dir, matcher)) if (e.isDir && !e.name.startsWith(".")) await visit(e.path, depth + 1)
  }
  await visit(root, 0)
  // Two packages with the same folder name (apps/web, examples/web): name them by their path.
  const seen = new Map<string, number>()
  for (const s of out) seen.set(s.name, (seen.get(s.name) ?? 0) + 1)
  for (const s of out) if (seen.get(s.name)! > 1 && s.cwd !== root) s.name = relative(root, s.cwd)
  return out
}

/** Services from the config when it lists any, else the detected ones. */
export async function servicesFor(
  root: string,
  configured: { name: string; command: string; cwd?: string }[],
): Promise<Service[]> {
  if (configured.length)
    return configured.map((s) => ({ name: s.name, command: s.command, cwd: s.cwd ? resolve(root, s.cwd) : root }))
  return detectServices(root)
}

export interface ServiceError {
  /** The error's lines, as printed. */
  text: string
  /** The first place it points to in the project (not in node_modules), if any. */
  location: { path: string; line: number; col: number } | null
}

const ERROR_LINE = /\b(error|errors|exception|failed to|cannot find|is not defined|unhandled|fatal)\b|ERR!|✖|✘|\[ERROR\]/i
/** Lines that start a new round: a rebuild or restart went through, or is starting. Errors before one are over. */
const BOUNDARY_LINE =
  /found 0 errors|successfully started|compiled successfully|built in|ready in|hmr update|page reload|listening (on|at)|server (running|started)|started server on|nitro built|vite client warmed up|✔|file change detected|starting (incremental )?compilation|restarting|\brestarted\b/i
/** `file:line[:col]` with a source-like extension, absolute or relative. */
const LOCATION =
  /(?:file:\/\/)?((?:\/|\.{1,2}\/|[\w@~-][\w.@~-]*\/)[\w./@~-]*\.(?:[cm]?[jt]sx?|vue|svelte|py|go|rs|rb|php|java|kt|css|scss|sql|json|ya?ml))(?::(\d+))(?::(\d+))?/
/** A stack frame line ("    at fn (/x/y.js:3:7)"). */
const FRAME = /^\s+at\s/

/**
 * The current error in a service's recent output: from the first error line after the last
 * rebuild or restart, or null when there is none since. `lines` are plain text, oldest first.
 * (Compilers print the errors, then a summary like "Found 1 error": the first one is the cause.)
 */
export function lastError(lines: readonly string[], cwd: string): ServiceError | null {
  let boundary = -1
  for (let i = lines.length - 1; i >= 0; i--)
    if (BOUNDARY_LINE.test(lines[i]!)) {
      boundary = i
      break
    }
  let start = -1
  for (let i = boundary + 1; i < lines.length; i++)
    if (ERROR_LINE.test(lines[i]!) && !FRAME.test(lines[i]!)) {
      start = i
      break
    }
  if (start < 0) return null
  // From the error to the end (its stack, code frame, the other errors), at most 40 lines.
  const block = lines.slice(start, Math.min(lines.length, start + 40))
  while (block.length && !block[block.length - 1]!.trim()) block.pop()
  return { text: block.join("\n"), location: locate(block, cwd) }
}

/** The first `file:line` in the block that is a project file: not inside node_modules or Node itself. */
function locate(block: readonly string[], cwd: string): ServiceError["location"] {
  for (const l of block) {
    const m = LOCATION.exec(l)
    if (!m) continue
    const file = m[1]!
    if (file.includes("node_modules/") || file.startsWith("node:")) continue
    return { path: isAbsolute(file) ? file : resolve(cwd, file), line: Number(m[2]), col: Number(m[3] ?? 1) }
  }
  return null
}

// CSI (colours, cursor moves), OSC (titles, links; ended by BEL or ST) and two-byte escapes.
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g

/** A service's recent output as plain text lines (no colours), for finding its errors. */
export class OutputLines {
  private done: string[] = []
  private partial = ""
  private decoder = new TextDecoder()

  constructor(private readonly max = 400) {}

  push(data: Uint8Array): void {
    const text = (this.partial + this.decoder.decode(data, { stream: true })).replace(ANSI, "")
    const parts = text.split("\n")
    this.partial = parts.pop()!
    for (const p of parts) this.done.push(lastSegment(p))
    if (this.done.length > this.max) this.done.splice(0, this.done.length - this.max)
  }

  /** Complete lines, oldest first. */
  lines(): string[] {
    return this.done
  }

  clear(): void {
    this.done = []
    this.partial = ""
  }
}

/** What a line shows after carriage returns rewrote it ("10%\r100%" shows "100%"). */
function lastSegment(line: string): string {
  const l = line.endsWith("\r") ? line.slice(0, -1) : line
  const i = l.lastIndexOf("\r")
  return i < 0 ? l : l.slice(i + 1)
}

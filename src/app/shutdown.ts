import type { CliRenderer } from "@opentui/core"

type Hook = () => void | Promise<void>

let renderer: CliRenderer | null = null
let savedStty: string | null = null
let shuttingDown = false
const hooks: Hook[] = []

/** Disable XON/XOFF flow control so Ctrl+S / Ctrl+Q reach the app. Restored on shutdown. */
export function prepareTerminal(): void {
  if (!process.stdin.isTTY) return
  try {
    const saved = Bun.spawnSync(["stty", "-g"], { stdin: "inherit", stdout: "pipe", stderr: "ignore" })
    if (saved.success) savedStty = saved.stdout.toString().trim()
    Bun.spawnSync(["stty", "-ixon"], { stdin: "inherit", stdout: "ignore", stderr: "ignore" })
  } catch {
    // stty is optional; without it Ctrl+S may be swallowed by the terminal.
  }
}

export function registerRenderer(r: CliRenderer): void {
  renderer = r
}

/** Hooks run before the renderer is destroyed (kill child processes, destroy native styles, ...). */
export function onShutdown(hook: Hook): () => void {
  hooks.push(hook)
  return () => {
    const i = hooks.indexOf(hook)
    if (i >= 0) hooks.splice(i, 1)
  }
}

/**
 * Run shutdown hooks, restore the terminal and exit. `after` runs once the terminal is back
 * to normal (used to start a new editor process); its result replaces the exit code.
 */
export async function shutdown(exitCode = 0, after?: () => Promise<number | void>): Promise<never> {
  if (shuttingDown) return new Promise<never>(() => {})
  shuttingDown = true
  for (const hook of hooks.splice(0)) {
    try {
      await hook()
    } catch {
      // keep going; the terminal must be restored regardless
    }
  }
  try {
    renderer?.destroy()
  } catch {
    // ignore
  }
  if (savedStty) {
    try {
      Bun.spawnSync(["stty", savedStty], { stdin: "inherit", stdout: "ignore", stderr: "ignore" })
    } catch {
      // ignore
    }
  }
  if (after) {
    try {
      const code = await after()
      if (typeof code === "number") exitCode = code
    } catch (err) {
      console.error(err)
      exitCode = 1
    }
  }
  process.exit(exitCode)
}

export function installSignalHandlers(): void {
  process.on("SIGINT", () => void shutdown(130))
  process.on("SIGTERM", () => void shutdown(143))
  process.on("SIGHUP", () => void shutdown(129))
  process.on("uncaughtException", (err) => {
    void shutdown(1).finally(() => console.error(err))
  })
  process.on("unhandledRejection", (err) => {
    void shutdown(1).finally(() => console.error(err))
  })
}

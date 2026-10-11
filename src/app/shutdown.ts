import type { CliRenderer } from "@opentui/core"
import { appendFileSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

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
export async function shutdown(exitCode = 0, after?: () => Promise<number | void>, error?: unknown): Promise<never> {
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
  // Printed once the terminal is back to normal, so it stays readable.
  if (error !== undefined) console.error(error)
  process.exit(exitCode)
}

/**
 * What to do with an internal error (an exception or rejection nobody caught). The app sets one
 * that backs up unsaved work and shows the error; without it (startup), an error quits.
 */
let internalErrorHandler: ((err: unknown) => void | Promise<void>) | null = null
let crashSaver: (() => Promise<unknown>) | null = null
export function setInternalErrorHandler(handler: typeof internalErrorHandler, saver: typeof crashSaver): void {
  internalErrorHandler = handler
  crashSaver = saver
}

/** Back up unsaved work (when the app has said how), never throwing. */
export async function saveForCrash(): Promise<void> {
  await crashSaver?.().catch(() => null)
}

const recentErrors: number[] = []
/** Errors this close together mean something is stuck in a loop: stop instead of flooding. */
const ERROR_BURST = 5
const ERROR_WINDOW_MS = 10_000

async function onInternalError(err: unknown): Promise<void> {
  logError(err)
  const now = Date.now()
  recentErrors.push(now)
  while (recentErrors.length && now - recentErrors[0]! > ERROR_WINDOW_MS) recentErrors.shift()
  if (!internalErrorHandler || recentErrors.length >= ERROR_BURST) {
    await saveForCrash()
    return void shutdown(1, undefined, err)
  }
  try {
    await internalErrorHandler(err)
  } catch {
    // the handler itself failed: nothing more to do than keep running
  }
}

/** Where internal errors are logged (for bug reports: see ai/reportIssue.ts). */
export function errorLogPath(): string {
  return join(Bun.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "copane", "errors.log")
}

/** Append to the error log. Never throws. */
function logError(err: unknown): void {
  try {
    const path = errorLogPath()
    const text = err instanceof Error ? (err.stack ?? err.message) : String(err)
    // Synchronous: this may be the last thing the process does. Bun has no append API.
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, `${new Date().toISOString()} ${text}\n`)
  } catch {
    // no log, then
  }
}

export function installSignalHandlers(): void {
  process.on("SIGINT", () => void shutdown(130))
  process.on("SIGTERM", () => void shutdown(143))
  process.on("SIGHUP", () => void shutdown(129))
  process.on("uncaughtException", (err) => void onInternalError(err))
  process.on("unhandledRejection", (err) => void onInternalError(err))
}

// Listing /proc has no Bun API; reading each stat file does.
import { readdir } from "node:fs/promises"
import type { Subprocess } from "bun"

/** PIDs whose session id is `sid` (Linux /proc). Empty elsewhere. */
export async function sessionMembers(sid: number): Promise<number[]> {
  if (process.platform !== "linux") return []
  const out: number[] = []
  let entries: string[]
  try {
    entries = await readdir("/proc")
  } catch {
    return out
  }
  for (const name of entries) {
    if (!/^\d+$/.test(name)) continue
    try {
      const stat = await Bun.file(`/proc/${name}/stat`).text()
      // Fields after the parenthesised command: state ppid pgrp session ...
      const rest = stat.slice(stat.lastIndexOf(")") + 2).split(" ")
      if (Number(rest[3]) === sid) out.push(Number(name))
    } catch {
      // process exited meanwhile
    }
  }
  return out
}

export type AgentStatus =
  | { kind: "idle" }
  | { kind: "running"; pid: number }
  | { kind: "exited"; code: number | null; signal: string | null }
  | { kind: "error"; message: string }

export interface AgentProcessOptions {
  command: string
  args?: string[]
  cwd: string
  env?: Record<string, string | undefined>
  onOutput: (data: Uint8Array) => void
  onStatus?: (status: AgentStatus) => void
}

/** A CLI program running in a pseudo-terminal (Bun.spawn with `terminal`). POSIX only. */
export class AgentProcess {
  private proc: Subprocess | null = null
  private _status: AgentStatus = { kind: "idle" }

  constructor(private opts: AgentProcessOptions) {}

  get status(): AgentStatus {
    return this._status
  }

  private setStatus(s: AgentStatus): void {
    this._status = s
    this.opts.onStatus?.(s)
  }

  /** Resolve the command on PATH (or as a path). Returns null when not found. */
  static resolveCommand(command: string, cwd: string): string | null {
    return Bun.which(command, { cwd }) ?? null
  }

  start(cols: number, rows: number): void {
    if (this.proc) return
    const exe = AgentProcess.resolveCommand(this.opts.command, this.opts.cwd)
    if (!exe) {
      this.setStatus({ kind: "error", message: `"${this.opts.command}" not found in PATH` })
      return
    }
    try {
      const proc = Bun.spawn([exe, ...(this.opts.args ?? [])], {
        cwd: this.opts.cwd,
        env: { ...Bun.env, ...this.opts.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
        terminal: {
          cols: Math.max(1, Math.floor(cols)),
          rows: Math.max(1, Math.floor(rows)),
          data: (_t, data) => this.opts.onOutput(data),
        },
      })
      this.proc = proc
      this.setStatus({ kind: "running", pid: proc.pid })
      void proc.exited.then((code) => {
        if (this.proc !== proc) return // kill() owns it
        this.proc = null
        // The PTY is ours to close (a file descriptor and native memory per CLI run otherwise).
        closeTerminal(proc)
        this.setStatus({ kind: "exited", code, signal: proc.signalCode == null ? null : String(proc.signalCode) })
      })
    } catch (err) {
      this.setStatus({ kind: "error", message: (err as Error).message })
    }
  }

  write(data: string | Uint8Array): void {
    const t = this.proc?.terminal
    if (t && !t.closed) t.write(data)
  }

  resize(cols: number, rows: number): void {
    const t = this.proc?.terminal
    if (t && !t.closed && cols > 0 && rows > 0) t.resize(Math.floor(cols), Math.floor(rows))
  }

  /**
   * Behave like a closing terminal for the CLI and everything in its PTY session:
   * SIGHUP then SIGTERM, SIGKILL for stragglers. Resolves when the CLI is gone.
   */
  async kill(graceMs = 1500): Promise<void> {
    const proc = this.proc
    if (!proc) return
    this.proc = null
    // The child leads its own session on the PTY; collect members before it exits.
    const members = new Set(await sessionMembers(proc.pid))
    const signalAll = (sig: NodeJS.Signals, pids: Iterable<number>) => {
      for (const pid of pids) {
        try {
          process.kill(pid, sig)
        } catch {
          // already gone
        }
      }
    }
    signalAll("SIGHUP", [proc.pid, ...members])
    signalAll("SIGTERM", [proc.pid, ...members])
    // Background jobs may survive both; kill whatever is left of the session shortly after.
    const sweep = setTimeout(() => signalAll("SIGKILL", [...members].filter((p) => p !== proc.pid)), Math.min(graceMs, 300))
    const timer = setTimeout(() => signalAll("SIGKILL", [proc.pid, ...members]), graceMs)
    try {
      const code = await proc.exited
      this.setStatus({ kind: "exited", code, signal: proc.signalCode == null ? null : String(proc.signalCode) })
    } finally {
      clearTimeout(timer)
      closeTerminal(proc)
    }
    // Let the sweep run if the leader exited first.
    await new Promise((r) => setTimeout(r, Math.min(graceMs, 300) + 20))
    clearTimeout(sweep)
  }
}

function closeTerminal(proc: { terminal?: { close(): void } | null }): void {
  try {
    proc.terminal?.close()
  } catch {
    // already closed
  }
}

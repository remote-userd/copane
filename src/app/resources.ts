import { readdir } from "node:fs/promises"
import { basename } from "node:path"
import { useEffect, useState } from "react"

/** One process: resident memory in bytes and CPU time used so far, in seconds. */
export type ProcInfo = { pid: number; ppid: number; name: string; rss: number; cpuSec: number }

/** A row of the breakdown: the editor itself, or a process it started with everything under it. */
export type UsageRow = { pid: number; name: string; rss: number; cpu: number }

/** What copane uses: the editor, each process it started (language servers, agents, terminals), and the sum. */
export type Usage = { self: UsageRow; children: UsageRow[]; total: { rss: number; cpu: number } }

/** `/proc/<pid>/stat`: the name is in parentheses and may contain spaces or parentheses itself. */
export function parseProcStat(text: string, pageSize: number, clockTicks: number): ProcInfo | null {
  const open = text.indexOf("(")
  const close = text.lastIndexOf(")")
  if (open < 0 || close < open) return null
  // Fields after the name, numbered from 3 (state) as in proc(5).
  const f = text.slice(close + 2).split(" ")
  const at = (n: number) => Number(f[n - 3])
  return {
    pid: Number(text.slice(0, open)),
    ppid: at(4),
    name: text.slice(open + 1, close),
    cpuSec: (at(14) + at(15)) / clockTicks,
    rss: at(24) * pageSize,
  }
}

/** `ps -o time` / `cputime`: `[[dd-]hh:]mm:ss[.cc]`, in seconds. */
export function parsePsTime(t: string): number {
  const [days, rest] = t.includes("-") ? [Number(t.split("-")[0]), t.split("-")[1]!] : [0, t]
  return days * 86400 + rest.split(":").reduce((sum, part) => sum * 60 + Number(part), 0)
}

let procConsts: { pageSize: number; clockTicks: number } | null = null
function linuxConsts() {
  if (procConsts) return procConsts
  const get = (name: string, fallback: number) => {
    try {
      const out = Bun.spawnSync(["getconf", name]).stdout.toString().trim()
      return Number(out) || fallback
    } catch {
      return fallback
    }
  }
  return (procConsts = { pageSize: get("PAGESIZE", 4096), clockTicks: get("CLK_TCK", 100) })
}

async function listLinux(): Promise<ProcInfo[]> {
  const { pageSize, clockTicks } = linuxConsts()
  const pids = (await readdir("/proc")).filter((n) => /^\d+$/.test(n))
  const all = await Promise.all(
    pids.map((pid) =>
      Bun.file(`/proc/${pid}/stat`)
        .text()
        .then((t) => parseProcStat(t, pageSize, clockTicks))
        // Processes come and go between the listing and the read.
        .catch(() => null),
    ),
  )
  return all.filter((p): p is ProcInfo => p !== null)
}

async function listPs(): Promise<ProcInfo[]> {
  const p = Bun.spawn(["ps", "-A", "-o", "pid=,ppid=,rss=,time=,comm="], { stdout: "pipe", stderr: "ignore" })
  const out = await Bun.readableStreamToText(p.stdout)
  const procs: ProcInfo[] = []
  for (const line of out.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line)
    if (m) procs.push({ pid: +m[1]!, ppid: +m[2]!, rss: +m[3]! * 1024, cpuSec: parsePsTime(m[4]!), name: basename(m[5]!.trim()) })
  }
  return procs
}

/** Every process on the machine (Linux reads /proc, others ask `ps`). */
export async function listProcesses(): Promise<ProcInfo[]> {
  return process.platform === "linux" ? listLinux() : listPs()
}

/** Runtimes and shells that wrap the program worth naming (`node …/typescript-language-server`). */
const WRAPPERS = new Set(["node", "bun", "bunx", "npx", "deno", "python", "python3", "sh", "bash", "zsh", "env"])

/** A readable name for a process copane started: the program it runs rather than `node`. */
async function commandName(pid: number, fallback: string): Promise<string> {
  if (process.platform !== "linux") return fallback
  try {
    const args = (await Bun.file(`/proc/${pid}/cmdline`).text()).split("\0").filter(Boolean)
    const program = args.find((a, i) => !a.startsWith("-") && !(WRAPPERS.has(basename(a)) && i < args.length - 1))
    return program ? basename(program) : fallback
  } catch {
    return fallback
  }
}

/**
 * Group processes under `root`: the root alone, then each direct child with all its descendants.
 * CPU is a percentage of one core between `prev` (CPU seconds by pid) and now, as `top` shows it.
 */
export function aggregate(
  procs: ProcInfo[],
  root: number,
  prev: Map<number, number>,
  elapsedSec: number,
  names: Map<number, string> = new Map(),
): Usage {
  const kids = new Map<number, ProcInfo[]>()
  for (const p of procs) kids.set(p.ppid, [...(kids.get(p.ppid) ?? []), p])
  const cpuOf = (p: ProcInfo) => {
    const before = prev.get(p.pid)
    return before === undefined || elapsedSec <= 0 ? 0 : Math.max(0, ((p.cpuSec - before) / elapsedSec) * 100)
  }
  const subtree = (p: ProcInfo): { rss: number; cpu: number } => {
    let rss = p.rss
    let cpu = cpuOf(p)
    for (const c of kids.get(p.pid) ?? []) {
      const s = subtree(c)
      rss += s.rss
      cpu += s.cpu
    }
    return { rss, cpu }
  }
  const me = procs.find((p) => p.pid === root)
  const self = { pid: root, name: "ce", rss: me?.rss ?? 0, cpu: me ? cpuOf(me) : 0 }
  const children = (kids.get(root) ?? []).map((c) => ({ pid: c.pid, name: names.get(c.pid) ?? c.name, ...subtree(c) }))
  children.sort((a, b) => b.rss - a.rss)
  const total = children.reduce((t, c) => ({ rss: t.rss + c.rss, cpu: t.cpu + c.cpu }), { rss: self.rss, cpu: self.cpu })
  return { self, children, total }
}

/** Samples copane's usage over time (CPU needs two readings). */
export function createResourceSampler(root = process.pid) {
  let prev = new Map<number, number>()
  let prevAt = 0
  const names = new Map<number, string>()
  return async function sample(): Promise<Usage> {
    const procs = await listProcesses()
    const now = performance.now()
    for (const p of procs) if (p.ppid === root && !names.has(p.pid)) names.set(p.pid, await commandName(p.pid, p.name))
    const usage = aggregate(procs, root, prev, prevAt ? (now - prevAt) / 1000 : 0, names)
    prev = new Map(procs.map((p) => [p.pid, p.cpuSec]))
    prevAt = now
    return usage
  }
}

/** 1.2G, 340M, 900K. */
export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)}G`
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)}M`
  return `${Math.round(n / 1024)}K`
}

/** The breakdown shown when the status-bar segment is clicked. */
export function describeUsage(u: Usage): string {
  const rows = [u.self, ...u.children]
  const width = Math.max(5, ...rows.map((r) => Bun.stringWidth(r.name)))
  const line = (name: string, rss: number, cpu: number) =>
    `${name.padEnd(width)}  ${formatBytes(rss).padStart(6)}  ${`${Math.round(cpu)}%`.padStart(5)}`
  return [
    `${"".padEnd(width)}  ${"memory".padStart(6)}  ${"cpu".padStart(5)}`,
    ...rows.map((r) => line(r.name, r.rss, r.cpu)),
    line("total", u.total.rss, u.total.cpu),
    "",
    "CPU is % of one core. Turn this off: “Toggle resource usage” (F1) or statusBar.resources.",
  ].join("\n")
}

/** Latest usage while `on`, sampled every `ms`; null when off or before the first reading. */
export function useResourceUsage(on: boolean, ms = 2000): Usage | null {
  const [usage, setUsage] = useState<Usage | null>(null)
  useEffect(() => {
    if (!on) {
      setUsage(null)
      return
    }
    const sample = createResourceSampler()
    let stopped = false
    const tick = () =>
      sample()
        .then((u) => !stopped && setUsage(u))
        .catch(() => null)
    void tick()
    const timer = setInterval(() => void tick(), ms)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [on, ms])
  return usage
}

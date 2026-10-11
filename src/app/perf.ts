import type { CliRenderer } from "@opentui/core"

/** React commits since the last log line (counted by perfCommit through a <Profiler>). */
let commits = 0
let commitMs = 0
/** For <Profiler onRender>: counts React commits and their render time. React keeps profiling only in development builds (`bun run dev`), so the compiled binary logs no commits. */
export function perfCommit(_id: string, _phase: string, actualMs: number): void {
  commits++
  commitMs += actualMs
}

/**
 * Opt-in performance log (CE_PERF=/path/to/log): time from each keypress to the end of the
 * next rendered frame, frames that take longer than 50 ms, and React commits per second.
 */
export function installPerfLog(renderer: CliRenderer): void {
  const path = Bun.env.CE_PERF
  if (!path) return
  const writer = Bun.file(path).writer()
  const tick = setInterval(() => {
    if (!commits) return
    writer.write(`commits ${commits}/s ${commitMs.toFixed(1)}ms\n`)
    writer.flush()
    commits = 0
    commitMs = 0
  }, 1000)
  tick.unref?.()
  let pendingKey: { name: string; at: number } | null = null
  renderer.keyInput.on("keypress", (k: { name: string }) => {
    pendingKey ??= { name: k.name, at: performance.now() }
  })
  renderer.setFrameCallback(async (deltaMs: number) => {
    const now = performance.now()
    if (pendingKey) {
      // The frame callback runs before the frame is drawn; finish timing on the next tick.
      const key = pendingKey
      pendingKey = null
      setTimeout(() => {
        writer.write(`key ${key.name} ${(performance.now() - key.at).toFixed(1)}ms\n`)
        writer.flush()
      }, 0)
    }
    if (deltaMs > 50) writer.write(`gap ${deltaMs.toFixed(1)}ms at ${now.toFixed(0)}\n`)
  })
}

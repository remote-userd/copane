import type { CliRenderer } from "@opentui/core"

/**
 * Opt-in performance log (CE_PERF=/path/to/log): time from each keypress to the end of the
 * next rendered frame, and frames that take longer than 16 ms.
 */
export function installPerfLog(renderer: CliRenderer): void {
  const path = Bun.env.CE_PERF
  if (!path) return
  const writer = Bun.file(path).writer()
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

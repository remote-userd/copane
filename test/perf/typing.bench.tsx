/**
 * Typing benchmark: `bun run test/perf/typing.bench.tsx`. Not part of `bun test`.
 * Opens 10 tabs (the active one ~5k lines of TypeScript), then times typing and cursor
 * moves through the real app, and the CPU spent in total, including debounced work.
 */
import { act } from "react"
import { createWorkspace, fixture, renderApp } from "../helpers"

const big = Array.from({ length: 5000 }, (_, i) => `export function fn${i}(value: number): number { return value * ${i} + total }`).join("\n") + "\n"
const files: Record<string, string> = { "big.ts": big }
for (let i = 0; i < 9; i++) files[`f${i}.ts`] = big.slice(0, 200_000)
const root = await fixture(files)
const ws = createWorkspace(root)
for (let i = 0; i < 9; i++) await ws.buffers.open(`f${i}.ts`)
await ws.buffers.open("big.ts")
const h = await renderApp(ws)
await Bun.sleep(4000) // let every tab's first syntax highlight finish
await h.setup.renderOnce()

async function time(label: string, n: number, key: () => void) {
  const cpu0 = process.cpuUsage()
  const t: number[] = []
  for (let i = 0; i < n; i++) {
    const s = performance.now()
    await act(async () => key())
    await h.setup.renderOnce()
    t.push(performance.now() - s)
    if (Bun.env.BENCH_SLOW && t.at(-1)! > 50) console.log(`slow #${i} ${t.at(-1)!.toFixed(0)}ms`)
    await Bun.sleep(5) // keystrokes ~ as fast as key repeat; lets short debounces fire sometimes
  }
  await Bun.sleep(400) // let debounced work finish
  const cpu = process.cpuUsage(cpu0)
  t.sort((a, b) => a - b)
  const p = (q: number) => t[Math.floor(q * (t.length - 1))]!.toFixed(2)
  console.log(`${label.padEnd(10)} median ${p(0.5)}ms  p95 ${p(0.95)}ms  max ${p(1)}ms  cpu ${((cpu.user + cpu.system) / 1000).toFixed(0)}ms`)
}

ws.buffers.active!.textarea!.setCursor(2500, 10)
console.log(`mark ${Math.round(performance.timeOrigin * 1000 + performance.now() * 1000)}`)
await time("type", 200, () => h.keys.typeText("a"))
await time("arrows", 200, () => h.keys.pressArrow("down"))
h.setup.renderer.destroy()
process.exit(0)

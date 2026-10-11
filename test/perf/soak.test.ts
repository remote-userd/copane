/**
 * A day's worth of agent activity in a few seconds: what copane keeps per turn, per chunk of
 * output and per file must stay bounded (the editor runs all day with agents streaming).
 */
import { expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { AgentWatch } from "../../src/ai/alerts"
import { AiReview } from "../../src/ai/review"
import { TurnLog } from "../../src/ai/turns"
import { BufferStore } from "../../src/editor/BufferStore"
import { fixture } from "../helpers"

test("100 AI turns: the turn log, the review's bookkeeping and the agent watch stay bounded", async () => {
  const root = await fixture({ "a.ts": "a\n", "b.ts": "b\n" })
  const log = new TurnLog(root, () => null) // no git: "before" is the hint
  const review = new AiReview(new BufferStore({ root }))
  review.watch(log)
  const watch = new AgentWatch(() => {})
  let now = 0
  for (let turn = 0; turn < 100; turn++) {
    await log.begin(`prompt ${turn}`, now)
    for (let chunk = 0; chunk < 50; chunk++) watch.output(`\x1b[32mtoken ${turn}.${chunk} `.repeat(20), (now += 10))
    for (const f of ["a.ts", "b.ts", `tmp-${turn}.ts`]) {
      const path = join(root, f)
      writeFileSync(path, `turn ${turn}\n`)
      await log.fileChanged(path, `before ${turn}\n`)
    }
    watch.tick((now += 2000))
    await log.end(now)
    review.acceptAll() // as if reviewed or committed
  }
  expect(log.turns.length).toBeLessThanOrEqual(30)
  // Bookkeeping only for turns still in the log: 3 files each.
  expect((review as unknown as { seen: Set<string> }).seen.size).toBeLessThanOrEqual(30 * 3)
  expect((watch as unknown as { tail: string }).tail.length).toBeLessThanOrEqual(8000)
  // Each turn keeps a hash of the "after" text, not a second copy.
  for (const t of log.turns) for (const f of t.files) expect(typeof f.afterHash).toBe("string")
}, 30_000)

import { expect, test } from "bun:test"
import { Glide } from "../../src/app/glide"

test("a glide moves the whole distance in shrinking steps", async () => {
  const steps: number[] = []
  new Glide(true, 5).by(30, (k) => steps.push(k))
  await Bun.sleep(120)
  expect(steps.reduce((a, b) => a + b, 0)).toBe(30)
  expect(steps[0]).toBe(10) // a third of what's left first...
  expect(steps.at(-1)).toBe(1) // ...down to single lines at the end
  for (let i = 1; i < steps.length; i++) expect(steps[i]!).toBeLessThanOrEqual(steps[i - 1]!)
})

test("same-direction scrolls add up; the other direction starts over", async () => {
  let pos = 0
  const g = new Glide(true, 5)
  g.by(6, (k) => (pos += k))
  g.by(6, (k) => (pos += k))
  await Bun.sleep(100)
  expect(pos).toBe(12)
  g.by(9, (k) => (pos += k))
  g.by(-3, (k) => (pos += k)) // drops what was left of the +9
  await Bun.sleep(100)
  expect(pos).toBeLessThan(12 + 9)
  expect(g.active).toBe(false)
})

test("stop ends it where it is; disabled moves at once", async () => {
  let pos = 0
  const g = new Glide(true, 5)
  g.by(60, (k) => (pos += k))
  g.stop()
  const at = pos
  await Bun.sleep(50)
  expect(pos).toBe(at)
  const off = new Glide(false)
  let moved = 0
  off.by(7, (k) => (moved += k))
  expect(moved).toBe(7)
})

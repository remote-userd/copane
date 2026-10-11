import { afterEach, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { testRender } from "@opentui/react/test-utils"
import { AnimatedImage } from "../../src/preview/AnimatedImage"
import { createWorkspace, fixture, renderApp, type Harness } from "../helpers"
import { makeGif } from "../support/gif"

let cleanup: (() => void) | null = null
afterEach(() => {
  cleanup?.()
  cleanup = null
})

/** A 16×8 GIF: a red frame, then a blue one, 50 ms each. */
function redBlue(): Uint8Array {
  return makeGif(16, 8, [[255, 0, 0], [0, 0, 255]], [
    { width: 16, height: 8, pixels: Array(128).fill(0), delayCs: 5 },
    { width: 16, height: 8, pixels: Array(128).fill(1), delayCs: 5 },
  ])
}

/** Which of red and blue appear on screen. */
function colours(frame: { lines: { spans: { fg: { r: number; g: number; b: number }; bg: { r: number; g: number; b: number } }[] }[] }) {
  const seen = new Set<string>()
  for (const line of frame.lines)
    for (const span of line.spans)
      for (const c of [span.fg, span.bg]) {
        if (c.r > 0.8 && c.b < 0.2) seen.add("red")
        if (c.b > 0.8 && c.r < 0.2) seen.add("blue")
      }
  return seen
}

async function play(playing: boolean): Promise<Set<string>> {
  const root = await fixture({})
  const path = join(root, "anim.gif")
  writeFileSync(path, redBlue())
  const setup = await testRender(<AnimatedImage path={path} width={8} height={4} protocol="blocks" playing={playing} />, { width: 20, height: 6 })
  cleanup = () => setup.renderer.destroy()
  const seen = new Set<string>()
  for (let i = 0; i < 25; i++) {
    await Bun.sleep(20)
    await setup.renderOnce()
    for (const c of colours(setup.captureSpans())) seen.add(c)
  }
  return seen
}

test("an animated GIF plays its frames", async () => {
  expect([...(await play(true))].sort()).toEqual(["blue", "red"])
})

test("paused, it stays on the first frame", async () => {
  expect([...(await play(false))]).toEqual(["red"])
})

test("the image tab shows the frame count, and Space pauses and resumes", async () => {
  const root = await fixture({})
  writeFileSync(join(root, "anim.gif"), redBlue())
  const ws = createWorkspace(root)
  await ws.buffers.open(join(root, "anim.gif"))
  const h: Harness = await renderApp(ws, { tree: <text>TREE</text> })
  cleanup = () => h.setup.renderer.destroy()
  expect(h.frame()).toContain("GIF · 16×8")
  expect(h.frame()).toContain("2 frames")
  expect(h.frame()).toContain("▶ playing")
  await h.step(() => h.keys.pressKey(" "))
  expect(h.frame()).toContain("⏸ paused")
  await h.step(() => h.keys.pressKey(" "))
  expect(h.frame()).toContain("▶ playing")
})

import { afterEach, expect, test } from "bun:test"
import { testRender } from "@opentui/react/test-utils"
import { Modal } from "../../src/app/Modal"

let destroy: (() => void) | null = null
afterEach(() => destroy?.())

/** The brightness (0–255) of the character at column x of row y. */
async function brightnessBehind(dialogWidth: number, x: number, y = 0): Promise<{ char: string; fg: number }> {
  const s = await testRender(
    <box width={100} height={20}>
      <text fg="#ffffff">{"ready".padStart(100)}</text>
      <Modal title="Dialog" width={dialogWidth} height={10}>
        <text>inside</text>
      </Modal>
    </box>,
    { width: 100, height: 20 },
  )
  destroy = () => s.renderer.destroy()
  await s.renderOnce()
  let col = 0
  for (const span of s.captureSpans().lines[y]!.spans) {
    if (x < col + span.width) return { char: span.text[x - col] ?? "", fg: span.fg.toInts()[0]! }
    col += span.width
  }
  throw new Error("column out of range")
}

test("a large dialog fades the screen behind it, so its margins show no stray letters", async () => {
  // The "y" of a pane header at the far right, in the margin beside a near-full-width dialog.
  const behind = await brightnessBehind(200, 99)
  expect(behind.char).toBe("y")
  expect(behind.fg).toBeLessThan(120)
})

test("small pop-ups (menus, pickers) leave the screen as it is", async () => {
  const behind = await brightnessBehind(40, 99)
  expect(behind.fg).toBe(255)
})

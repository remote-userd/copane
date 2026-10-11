import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { TextareaRenderable } from "@opentui/core"
import { createWorkspace } from "../../src/app/workspace"
import { saveBeforeAi } from "../../src/app/saveBeforeAi"
import { configSchema } from "../../src/config/schema"
import { fixture } from "../helpers"

class Ta {
  plainText = ""
  isDestroyed = false
  logicalCursor = { row: 0, col: 0 }
  lineCount = 1
  setText(t: string) { this.plainText = t }
  replaceText(t: string) { this.plainText = t }
  setCursor() {}
  removeHighlightsByRef() {}
  addHighlight() {}
}

async function setup(enabled: boolean) {
  const root = await fixture({ "a.txt": "old\n" })
  const ws = createWorkspace(root, { focus: "editor" }, configSchema.parse({ editor: { saveBeforeAi: enabled } }))
  const buf = await ws.buffers.open("a.txt")
  const ta = new Ta()
  ws.buffers.attach(buf.id, ta as unknown as TextareaRenderable)
  ta.plainText = "new\n"
  ws.buffers.onContentChange(buf.id)
  const stop = saveBeforeAi(ws)
  return { ws, root, buf, stop }
}

test("moving focus to the AI pane saves unsaved files", async () => {
  const { ws, root, buf, stop } = await setup(true)
  expect(buf.dirty).toBe(true)
  ws.ui.set({ focus: "ai" })
  await Bun.sleep(30)
  expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("new\n")
  expect(buf.dirty).toBe(false)
  expect(ws.ui.get().notice?.text).toContain("so the AI sees your changes")
  stop()
})

test("can be turned off", async () => {
  const { ws, root, stop } = await setup(false)
  ws.ui.set({ focus: "ai" })
  await Bun.sleep(30)
  expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("old\n")
  stop()
})

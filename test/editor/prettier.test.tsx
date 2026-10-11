import { afterEach, expect, test } from "bun:test"
import { chmod } from "node:fs/promises"
import { join } from "node:path"
import { configSchema } from "../../src/config/schema"
import { findPrettier } from "../../src/editor/prettier"
import { createWorkspace, fixture, renderApp, type Harness, waitUntil } from "../helpers"

let h: Harness | null = null
afterEach(() => {
  h?.setup.renderer.destroy()
  h = null
})

// A stand-in Prettier: upper-cases its input, and fails on "syntax error".
const FAKE = '#!/bin/sh\nin=$(cat)\ncase "$in" in *"syntax error"*) echo "[error] a.ts: SyntaxError: bad (1:1)" >&2; exit 2;; esac\nprintf "%s\\n" "$in" | tr a-z A-Z\n'

async function project(text: string, editor: Record<string, unknown> = {}) {
  const root = await fixture({ "src/a.ts": text, "node_modules/.bin/prettier": FAKE })
  await chmod(join(root, "node_modules/.bin/prettier"), 0o755)
  const ws = createWorkspace(root, undefined, configSchema.parse({ editor }))
  await ws.buffers.open("src/a.ts")
  h = await renderApp(ws, { tree: <text>TREE</text> })
  return { h, ws, root }
}

const until = (cond: () => boolean | Promise<boolean>, ms = 2000) => waitUntil(cond, ms)

test("the project's Prettier is found from the file up to the root", async () => {
  const root = await fixture({ "src/deep/a.ts": "", "node_modules/.bin/prettier": FAKE })
  expect(await findPrettier(join(root, "src/deep/a.ts"), root)).toBe(join(root, "node_modules/.bin/prettier"))
  const bare = await fixture({ "a.ts": "" })
  if (!Bun.which("prettier")) expect(await findPrettier(join(bare, "a.ts"), bare)).toBeNull()
})

test("Shift+Alt+F formats with the project's Prettier; errors are shown, the text kept", async () => {
  const { h, ws } = await project("const a = 1\n")
  const ta = ws.buffers.active!.textarea!
  await h.step(() => h.keys.pressKey("\x1bF"))
  await until(() => ta.plainText === "CONST A = 1\n")
  expect(ta.plainText).toBe("CONST A = 1\n")
  await until(() => h.frame().includes("Formatted with Prettier"))
  expect(h.frame()).toContain("Formatted with Prettier")
  ta.setText("syntax error\n")
  await h.step(() => h.keys.pressKey("\x1bF"))
  await until(() => h.frame().includes("SyntaxError"))
  expect(h.frame()).toContain("Prettier: [error] a.ts: SyntaxError")
  expect(ta.plainText).toBe("syntax error\n")
})

test("editor.formatOnSave formats before Ctrl+S writes", async () => {
  const { h, ws, root } = await project("let x\n", { formatOnSave: true })
  await h.step(() => h.keys.pressKey("s", { ctrl: true }))
  await until(() => ws.buffers.active!.textarea!.plainText === "LET X\n" && !ws.buffers.active!.dirty)
  expect(await Bun.file(join(root, "src/a.ts")).text()).toBe("LET X\n")
})

test("Ctrl+F starts with the word under the cursor, and typing replaces it", async () => {
  const { h, ws } = await project("let total = 0\ntotal += 1\n")
  ws.buffers.active!.textarea!.setCursor(0, 6)
  await h.step(() => h.keys.pressKey("f", { ctrl: true }))
  expect(ws.ui.get().findQuery).toBe("total")
  expect(h.frame()).toContain("1/2")
  await h.step(() => h.keys.typeText("let"))
  expect(ws.ui.get().findQuery).toBe("let")
})
